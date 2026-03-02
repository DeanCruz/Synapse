// ChainPipelineView — Chain row layout rendering
// ES module. Extracted from dashboard.js lines 655-761.

import { el } from '../utils/dom.js';
import { createAgentCard, createStatusBadge } from './AgentCardView.js';
import { drawDependencyLines, setupCardHoverEffects } from './DependencyLinesView.js';

/**
 * Render the chain pipeline layout.
 * Builds chain rows with wave column alignment, an SVG overlay for dependency lines,
 * and performs an atomic DOM swap via document fragment.
 *
 * @param {HTMLElement} container — the pipeline container element
 * @param {Array} chains — chain definitions from initialization.json
 * @param {Array} agents — agent entries (with merged progress data on status/summary/etc.)
 * @param {Array} waves — wave definitions from initialization.json
 * @param {Object} options
 * @param {string|null} options.activeStatFilter — status filter (e.g., 'completed'), or null for all
 * @param {Object} options.progressData — map of agent ID -> progress object (or {})
 * @param {function} options.onCardClick — callback(agent) when a card is clicked
 * @returns {{ cardElements: Object, cardElementMap: Object, renderedCardCount: number }}
 */
export function renderChainPipeline(container, chains, agents, waves, options) {
  var activeStatFilter = options.activeStatFilter || null;
  var progressData = options.progressData || {};
  var onCardClick = options.onCardClick || null;

  container.className = 'chain-pipeline';
  var frag = document.createDocumentFragment();
  var cardElementMap = {};

  var agentMap = {};
  for (var i = 0; i < agents.length; i++) {
    agentMap[agents[i].id] = agents[i];
  }

  // Build visibility set for stat card filtering
  var visibleAgents = activeStatFilter
    ? agents.filter(function (a) { return a.status === activeStatFilter; })
    : agents;
  var visibleIds = {};
  for (var i = 0; i < visibleAgents.length; i++) {
    visibleIds[visibleAgents[i].id] = true;
  }

  // Wave column header row
  var headerRow = el('div', { className: 'chain-header-row' });
  var labelCell = el('div', { className: 'chain-label-cell' });
  headerRow.appendChild(labelCell);

  for (var w = 0; w < waves.length; w++) {
    var waveHdr = el('div', {
      className: 'chain-wave-header' +
        (waves[w].status === 'in_progress' ? ' chain-wave-active' : '') +
        (waves[w].status === 'completed' ? ' chain-wave-done' : ''),
    });
    var hdrText = el('span', {
      className: 'wave-title',
      text: 'Wave ' + waves[w].id + ': ' + waves[w].name,
    });
    var hdrBadge = createStatusBadge(waves[w].status);
    waveHdr.appendChild(hdrText);
    waveHdr.appendChild(hdrBadge);
    headerRow.appendChild(waveHdr);
  }
  frag.appendChild(headerRow);

  // Card element map for SVG line drawing
  var cardElements = {};
  var renderedCardCount = 0;

  // Build chain rows
  for (var c = 0; c < chains.length; c++) {
    var chain = chains[c];
    var chainTasks = chain.tasks || [];

    // When filtering, skip chains with no visible agents
    if (activeStatFilter) {
      var hasVisible = false;
      for (var t = 0; t < chainTasks.length; t++) {
        if (visibleIds[chainTasks[t]]) { hasVisible = true; break; }
      }
      if (!hasVisible) continue;
    }

    var row = el('div', { className: 'chain-row' });
    var label = el('div', {
      className: 'chain-label',
      text: chain.name || ('Chain ' + chain.id),
    });
    row.appendChild(label);

    // One cell per wave column — find if this chain has a task in each wave
    for (var w = 0; w < waves.length; w++) {
      var cell = el('div', { className: 'chain-cell' });

      var taskId = null;
      for (var t = 0; t < chainTasks.length; t++) {
        var ag = agentMap[chainTasks[t]];
        if (ag && ag.wave === waves[w].id) {
          taskId = chainTasks[t];
          break;
        }
      }

      if (taskId && agentMap[taskId]) {
        if (!activeStatFilter || visibleIds[taskId]) {
          var agentProgress = progressData[taskId] || null;
          var callbacks = { onCardClick: onCardClick };
          var card = createAgentCard(agentMap[taskId], agentProgress, callbacks);
          cell.appendChild(card);
          cardElements[taskId] = card;
          cardElementMap[taskId] = card;
          renderedCardCount++;
        }
      }

      row.appendChild(cell);
    }

    frag.appendChild(row);
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
