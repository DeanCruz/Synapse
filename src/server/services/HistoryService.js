const fs = require('fs');
const path = require('path');
const { HISTORY_DIR } = require('../utils/constants');
const { readJSON } = require('../utils/json');
const {
  readDashboardInit,
  readDashboardProgress,
  readDashboardLogs,
} = require('./DashboardService');

// --- History Helpers ---

/**
 * List all history summary files, sorted newest-first by cleared_at.
 */
function listHistory() {
  try {
    if (!fs.existsSync(HISTORY_DIR)) return [];
    const files = fs.readdirSync(HISTORY_DIR).filter(f => f.endsWith('.json'));
    const summaries = [];
    for (const file of files) {
      const data = readJSON(path.join(HISTORY_DIR, file));
      if (data) summaries.push(data);
    }
    // Sort newest first by cleared_at
    summaries.sort((a, b) => (b.cleared_at || '').localeCompare(a.cleared_at || ''));
    return summaries;
  } catch {
    return [];
  }
}

/**
 * Build a history summary object from a dashboard's current data.
 * Derives stats, timing, and agent summaries from initialization + progress files.
 *
 * @param {string} id - Dashboard ID
 * @returns {Object} History summary object
 */
function buildHistorySummary(id) {
  const init = readDashboardInit(id);
  const progress = readDashboardProgress(id);
  const logs = readDashboardLogs(id);

  const task = (init && init.task) ? init.task : {};
  const agents = (init && init.agents) || [];
  const waves = (init && init.waves) || [];

  // Derive stats from progress
  let completed = 0, failed = 0, inProgress = 0, pending = 0;
  const agentSummaries = [];
  for (const agentDef of agents) {
    const prog = progress[agentDef.id];
    const status = prog ? prog.status : 'pending';
    if (status === 'completed') completed++;
    else if (status === 'failed') failed++;
    else if (status === 'in_progress') inProgress++;
    else pending++;

    agentSummaries.push({
      id: agentDef.id,
      title: agentDef.title,
      wave: agentDef.wave,
      status: status,
      assigned_agent: prog ? prog.assigned_agent : null,
      started_at: prog ? prog.started_at : null,
      completed_at: prog ? prog.completed_at : null,
      summary: prog ? prog.summary : null,
    });
  }

  // Derive timing
  const startedTimes = agentSummaries.filter(a => a.started_at).map(a => new Date(a.started_at).getTime());
  const completedTimes = agentSummaries.filter(a => a.completed_at).map(a => new Date(a.completed_at).getTime());
  const started_at = startedTimes.length > 0 ? new Date(Math.min(...startedTimes)).toISOString() : null;
  const completed_at = completedTimes.length > 0 ? new Date(Math.max(...completedTimes)).toISOString() : null;

  let duration = null;
  if (started_at && completed_at) {
    const diffMs = new Date(completed_at) - new Date(started_at);
    const totalSec = Math.floor(diffMs / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    duration = m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  const allDone = agents.length > 0 && agentSummaries.every(a => a.status === 'completed' || a.status === 'failed');
  const overall_status = allDone
    ? (failed > 0 ? 'completed_with_errors' : 'completed')
    : (inProgress > 0 ? 'in_progress' : 'pending');

  return {
    task_name: task.name || 'unnamed',
    task_type: task.type || null,
    project: task.project || null,
    directory: task.directory || null,
    prompt: task.prompt || null,
    overall_status: overall_status,
    total_tasks: agents.length,
    completed_tasks: completed,
    failed_tasks: failed,
    in_progress_tasks: inProgress,
    pending_tasks: pending,
    total_waves: waves.length,
    started_at: started_at,
    completed_at: completed_at,
    duration: duration,
    cleared_at: new Date().toISOString(),
    dashboard_id: id,
    agents: agentSummaries,
    log_count: (logs && logs.entries) ? logs.entries.length : 0,
  };
}

/**
 * Build a history summary and save it to the history/ directory.
 * Creates the history directory if it doesn't exist.
 *
 * @param {string} id - Dashboard ID
 * @returns {Object} The saved summary object
 */
function saveHistorySummary(id) {
  const summary = buildHistorySummary(id);

  if (!fs.existsSync(HISTORY_DIR)) {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
  }

  const today = new Date().toISOString().slice(0, 10);
  const historyFile = path.join(HISTORY_DIR, `${today}_${summary.task_name}.json`);
  fs.writeFileSync(historyFile, JSON.stringify(summary, null, 2));

  return summary;
}

module.exports = {
  listHistory,
  buildHistorySummary,
  saveHistorySummary,
};
