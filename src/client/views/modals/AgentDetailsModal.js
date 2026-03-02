// AgentDetailsModal — Shows agent details in a modal popup
// ES module. Displays agent id, title, badges, summary, dependencies, meta grid,
// milestones timeline, deviations list, and scrollable activity log.

import { el, colorWithAlpha } from '../../utils/dom.js';
import { formatTime, calcDuration, formatElapsed } from '../../utils/format.js';
import { STATUS_COLORS, STATUS_BG_COLORS } from '../../utils/constants.js';

/**
 * Create a status badge element for the given status string.
 * @param {string} status
 * @returns {HTMLElement}
 */
function createStatusBadge(status) {
  var label = status.replace(/_/g, ' ');
  var baseColor = STATUS_COLORS[status] || STATUS_COLORS.pending;
  return el('span', {
    className: 'status-badge',
    text: label,
    style: {
      backgroundColor: STATUS_BG_COLORS[status] || STATUS_BG_COLORS.pending,
      color: baseColor,
      border: '1px solid ' + baseColor,
      borderColor: colorWithAlpha(baseColor, 0.3),
    },
  });
}

/** @type {function|null} Escape key handler reference for cleanup */
var _onEsc = null;

/**
 * Show the agent details modal popup.
 * @param {object} agent — agent object with id, title, status, wave, layer, directory, assigned_agent, summary, depends_on, started_at, completed_at
 * @param {object} progressData — the progress data object keyed by agent id (e.g. { "2.1": { milestones, deviations, logs, ... } })
 * @param {function} findAgentFn — callback that looks up agent data by ID: findAgentFn(id) => agent|null
 */
export function showAgentDetails(agent, progressData, findAgentFn) {
  hideAgentDetails();

  var overlay = el('div', { className: 'agent-details-overlay', attrs: { id: 'agent-details-overlay' } });
  var modal = el('div', { className: 'agent-details-modal' });

  // Header — title + close
  var hdr = el('div', { className: 'agent-details-header' });
  var titleWrap = el('div', { className: 'agent-details-title-wrap' });
  var idEl = el('span', { className: 'agent-details-id', text: agent.id });
  var nameEl = el('span', { className: 'agent-details-name', text: agent.title });
  titleWrap.appendChild(idEl);
  titleWrap.appendChild(nameEl);
  var closeBtn = el('button', { className: 'task-details-close', text: '\u2715' });
  closeBtn.addEventListener('click', hideAgentDetails);
  hdr.appendChild(titleWrap);
  hdr.appendChild(closeBtn);
  modal.appendChild(hdr);

  // Body
  var body = el('div', { className: 'task-details-body' });

  // Badges row — status, wave, layer, directory, assigned agent
  var badges = el('div', { className: 'task-details-badges' });
  badges.appendChild(createStatusBadge(agent.status));

  if (agent.wave) {
    var waveBadge = el('span', {
      className: 'status-badge',
      text: 'Wave ' + agent.wave,
      style: {
        backgroundColor: 'rgba(102,126,234,0.1)',
        color: 'rgba(102,126,234,0.8)',
        border: '1px solid rgba(102,126,234,0.2)',
      },
    });
    badges.appendChild(waveBadge);
  }

  if (agent.layer) {
    var layerBadge = el('span', {
      className: 'status-badge',
      text: agent.layer,
      style: {
        backgroundColor: 'rgba(255,255,255,0.04)',
        color: 'var(--text-secondary)',
        border: '1px solid rgba(255,255,255,0.08)',
      },
    });
    badges.appendChild(layerBadge);
  }

  if (agent.directory) {
    var dirBadge = el('span', {
      className: 'status-badge',
      text: agent.directory,
      style: {
        backgroundColor: 'rgba(102,126,234,0.06)',
        color: 'rgba(102,126,234,0.7)',
        border: '1px solid rgba(102,126,234,0.15)',
      },
    });
    badges.appendChild(dirBadge);
  }

  if (agent.assigned_agent) {
    var agentBadge = el('span', {
      className: 'status-badge',
      text: agent.assigned_agent,
      style: {
        backgroundColor: 'rgba(155,124,240,0.08)',
        color: 'rgba(155,124,240,0.8)',
        border: '1px solid rgba(155,124,240,0.2)',
      },
    });
    badges.appendChild(agentBadge);
  }

  body.appendChild(badges);

  // Summary
  if (agent.summary) {
    var summary = el('p', { className: 'task-details-prompt', text: agent.summary });
    body.appendChild(summary);
  }

  // Dependencies
  var deps = agent.depends_on || [];
  if (deps.length > 0) {
    var depSection = el('div', { className: 'agent-details-deps' });
    var depLabel = el('span', { className: 'agent-details-deps-label', text: 'Depends on' });
    depSection.appendChild(depLabel);
    var depList = el('div', { className: 'agent-details-deps-list' });
    for (var i = 0; i < deps.length; i++) {
      var depAgent = findAgentFn(deps[i]);
      var depChip = el('span', {
        className: 'agent-details-dep-chip',
        text: deps[i] + (depAgent ? ' \u2014 ' + depAgent.title : ''),
      });
      if (depAgent) {
        depChip.style.borderColor = colorWithAlpha(STATUS_COLORS[depAgent.status] || STATUS_COLORS.pending, 0.3);
      }
      depList.appendChild(depChip);
    }
    depSection.appendChild(depList);
    body.appendChild(depSection);
  }

  // Meta grid
  var meta = el('div', { className: 'task-details-meta' });
  function metaItem(label, value) {
    if (!value) return;
    var item = el('div', { className: 'task-details-meta-item' });
    var lbl = el('span', { className: 'task-details-meta-label', text: label });
    var val = el('span', { className: 'task-details-meta-value', text: value });
    item.appendChild(lbl);
    item.appendChild(val);
    meta.appendChild(item);
  }
  metaItem('Started', agent.started_at ? formatTime(agent.started_at) : null);
  metaItem('Completed', agent.completed_at ? formatTime(agent.completed_at) : null);
  metaItem('Duration', agent.started_at && agent.completed_at
    ? calcDuration(agent.started_at, agent.completed_at)
    : agent.started_at
      ? formatElapsed(agent.started_at) + ' (running)'
      : null);
  metaItem('Status', agent.status ? agent.status.replace(/_/g, ' ') : null);
  if (meta.children.length) body.appendChild(meta);

  // Progress data — milestones, deviations, logs come from progressData parameter
  var agentProg = progressData ? progressData[agent.id] : null;

  // Progress milestones (from worker progress file)
  if (agentProg && agentProg.milestones && agentProg.milestones.length > 0) {
    var msSection = el('div', { className: 'agent-milestones' });
    var msLabel = el('span', { className: 'agent-milestones-label', text: 'Milestones' });
    msSection.appendChild(msLabel);
    for (var mi = 0; mi < agentProg.milestones.length; mi++) {
      var ms = agentProg.milestones[mi];
      var msItem = el('div', { className: 'agent-milestone-item' });
      var msTime = el('span', { className: 'agent-milestone-time', text: ms.at ? formatTime(ms.at) : '' });
      var msMsg = el('span', { className: 'agent-milestone-msg', text: ms.msg || '' });
      msItem.appendChild(msTime);
      msItem.appendChild(msMsg);
      msSection.appendChild(msItem);
    }
    body.appendChild(msSection);
  }

  // Deviations (from worker progress file)
  if (agentProg && agentProg.deviations && agentProg.deviations.length > 0) {
    var devSection = el('div', { className: 'agent-deviations' });
    var devLabel = el('span', { className: 'agent-deviations-label', text: '\u26A0 Deviations from Plan' });
    devSection.appendChild(devLabel);
    for (var di = 0; di < agentProg.deviations.length; di++) {
      var dev = agentProg.deviations[di];
      var devItem = el('div', { className: 'agent-deviation-item' });
      if (dev.at) {
        var devTime = el('span', { className: 'agent-deviation-time', text: formatTime(dev.at) });
        devItem.appendChild(devTime);
      }
      devItem.appendChild(document.createTextNode(dev.description || ''));
      devSection.appendChild(devItem);
    }
    body.appendChild(devSection);
  }

  // Logs (from worker progress file) — scrollable activity log
  var logsBox = null;
  if (agentProg && agentProg.logs && agentProg.logs.length > 0) {
    var logsSection = el('div', { className: 'agent-logs-section' });
    var logsLabel = el('span', { className: 'agent-logs-label', text: 'Activity Log' });
    logsSection.appendChild(logsLabel);
    logsBox = el('div', { className: 'agent-logs-box' });
    for (var li = 0; li < agentProg.logs.length; li++) {
      var logEntry = agentProg.logs[li];
      var logRow = el('div', { className: 'agent-log-entry' });
      var logTime = el('span', {
        className: 'agent-log-time',
        text: logEntry.at ? formatTime(logEntry.at) : '',
      });
      var logLevel = el('span', {
        className: 'agent-log-level agent-log-level-' + (logEntry.level || 'info'),
        text: (logEntry.level || 'info').toUpperCase(),
      });
      var logMsg = el('span', {
        className: 'agent-log-msg',
        text: logEntry.msg || '',
      });
      logRow.appendChild(logTime);
      logRow.appendChild(logLevel);
      logRow.appendChild(logMsg);
      logsBox.appendChild(logRow);
    }
    logsSection.appendChild(logsBox);
    body.appendChild(logsSection);
  }

  modal.appendChild(body);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // Auto-scroll activity log to bottom after rendering
  if (logsBox) {
    setTimeout(function () { logsBox.scrollTop = logsBox.scrollHeight; }, 0);
  }

  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) hideAgentDetails();
  });

  _onEsc = function (e) {
    if (e.key === 'Escape') hideAgentDetails();
  };
  document.addEventListener('keydown', _onEsc);
}

/**
 * Hide the agent details modal and clean up the Escape listener.
 */
export function hideAgentDetails() {
  var existing = document.getElementById('agent-details-overlay');
  if (existing) existing.remove();
  if (_onEsc) {
    document.removeEventListener('keydown', _onEsc);
    _onEsc = null;
  }
}
