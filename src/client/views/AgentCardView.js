// AgentCardView — Agent card and status badge creation
// ES module. Extracted from dashboard.js lines 1272-1458.

import { el, colorWithAlpha } from '../utils/dom.js';
import { formatElapsed, calcDuration } from '../utils/format.js';
import { STATUS_COLORS, STATUS_BG_COLORS } from '../utils/constants.js';

/**
 * Create a status badge element with tinted bg (glass style).
 * @param {string} status
 * @returns {HTMLElement}
 */
export function createStatusBadge(status) {
  const label = status.replace(/_/g, ' ');
  var baseColor = STATUS_COLORS[status] || STATUS_COLORS.pending;
  const badge = el('span', {
    className: 'status-badge',
    text: label,
    style: {
      backgroundColor: STATUS_BG_COLORS[status] || STATUS_BG_COLORS.pending,
      color: baseColor,
      border: '1px solid ' + baseColor,
      borderColor: colorWithAlpha(baseColor, 0.3),
    },
  });
  return badge;
}

/**
 * Create an agent card element.
 * @param {object} agent — { id, title, status, layer, directory, assigned_agent, started_at, completed_at, summary }
 * @param {object|null} progressData — worker progress object { stage, message, milestones, deviations, logs } or null
 * @param {object} callbacks — { onCardClick(agent) }
 * @returns {HTMLElement}
 */
export function createAgentCard(agent, progressData, callbacks) {
  const card = el('div', {
    className: 'agent-card',
    attrs: { 'data-status': agent.status, 'data-agent-id': agent.id },
  });

  // Top row: ID + status dot + title
  const topRow = el('div', { className: 'agent-card-top' });

  const idSpan = el('span', { className: 'agent-id', text: agent.id });
  topRow.appendChild(idSpan);

  const dot = el('span', {
    className: 'status-dot',
    style: {
      backgroundColor: STATUS_COLORS[agent.status] || STATUS_COLORS.pending,
    },
  });
  topRow.appendChild(dot);

  const title = el('span', { className: 'agent-title', text: agent.title });
  topRow.appendChild(title);

  card.appendChild(topRow);

  // Meta row: layer badge + directory badge + agent assignment
  const metaRow = el('div', { className: 'agent-card-meta' });

  if (agent.layer) {
    const layerBadge = el('span', {
      className: 'layer-badge',
      text: agent.layer,
    });
    metaRow.appendChild(layerBadge);
  }

  if (agent.directory) {
    const dirBadge = el('span', {
      className: 'directory-badge',
      text: agent.directory,
    });
    metaRow.appendChild(dirBadge);
  }

  if (agent.assigned_agent) {
    const agentLabel = el('span', {
      className: 'agent-label',
      text: agent.assigned_agent,
    });
    metaRow.appendChild(agentLabel);
  }

  card.appendChild(metaRow);

  // Bottom row: time / summary / waiting (status-dependent)
  const bottomRow = el('div', { className: 'agent-card-bottom' });

  if (agent.status === 'completed') {
    if (agent.summary) {
      const summary = el('span', {
        className: 'agent-summary',
        text: agent.summary,
      });
      bottomRow.appendChild(summary);
    }
    if (agent.started_at && agent.completed_at) {
      const duration = el('span', {
        className: 'agent-duration',
        text: calcDuration(agent.started_at, agent.completed_at),
      });
      bottomRow.appendChild(duration);
    }
  } else if (agent.status === 'in_progress') {
    var stageRow = el('div', { className: 'agent-card-stage-row' });
    if (progressData && progressData.stage) {
      var stageBadge = el('span', {
        className: 'agent-stage',
        text: progressData.stage.replace(/_/g, ' '),
        attrs: { 'data-stage': progressData.stage },
      });
      stageRow.appendChild(stageBadge);
    }
    var elapsed = el('span', {
      className: 'agent-elapsed',
      attrs: { 'data-started': agent.started_at || '' },
      text: agent.started_at ? formatElapsed(agent.started_at) : '...',
    });
    stageRow.appendChild(elapsed);
    bottomRow.appendChild(stageRow);
    if (progressData && progressData.message) {
      var milestone = el('span', {
        className: 'agent-milestone',
        text: progressData.message,
      });
      bottomRow.appendChild(milestone);
    }
  } else if (agent.status === 'failed') {
    const failText = el('span', {
      className: 'agent-fail-text',
      text: agent.summary || 'Failed',
    });
    bottomRow.appendChild(failText);
  } else {
    const waiting = el('span', {
      className: 'agent-waiting',
      text: 'Waiting...',
    });
    bottomRow.appendChild(waiting);
  }

  card.appendChild(bottomRow);

  // Deviation badge — shown for any status if agent has reported deviations
  if (progressData && progressData.deviations && progressData.deviations.length > 0) {
    var devRow = el('div', { className: 'agent-card-meta', style: { marginTop: '6px' } });
    var devBadge = el('span', {
      className: 'deviation-badge',
      text: '\u26A0 ' + progressData.deviations.length + ' deviation' + (progressData.deviations.length > 1 ? 's' : ''),
    });
    devRow.appendChild(devBadge);
    card.appendChild(devRow);
  }

  // Stash agent data for detail popup
  card._agent = agent;
  card.style.cursor = 'pointer';
  card.addEventListener('click', function (e) {
    // Don't trigger if user is selecting text
    if (window.getSelection().toString()) return;
    if (callbacks && callbacks.onCardClick) {
      callbacks.onCardClick(agent);
    }
  });

  return card;
}
