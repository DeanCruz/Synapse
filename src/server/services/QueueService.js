const fs = require('fs');
const path = require('path');
const { QUEUE_DIR } = require('../utils/constants');
const { readJSON, readJSONAsync } = require('../utils/json');

/**
 * List all queued dashboard IDs (directories with initialization.json inside queue/).
 * Returns a sorted array of queue ID strings (e.g. ['queue1', 'queue2']).
 */
function listQueue() {
  try {
    if (!fs.existsSync(QUEUE_DIR)) return [];
    const entries = fs.readdirSync(QUEUE_DIR, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory() &&
        fs.existsSync(path.join(QUEUE_DIR, e.name, 'initialization.json')))
      .map(e => e.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * Get the absolute path to a queue item directory.
 */
function getQueueDir(id) {
  return path.join(QUEUE_DIR, id);
}

/**
 * Read a queue item's initialization.json (sync).
 */
function readQueueInit(id) {
  return readJSON(path.join(getQueueDir(id), 'initialization.json'));
}

/**
 * Read a queue item's initialization.json (async).
 */
async function readQueueInitAsync(id) {
  return readJSONAsync(path.join(getQueueDir(id), 'initialization.json'));
}

/**
 * Read all progress files from a queue item's progress/ directory (sync).
 * Returns an object keyed by task_id.
 */
function readQueueProgress(id) {
  const progressDir = path.join(getQueueDir(id), 'progress');
  const result = {};
  try {
    if (!fs.existsSync(progressDir)) return result;
    const files = fs.readdirSync(progressDir);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const data = readJSON(path.join(progressDir, file));
      if (data && data.task_id) {
        result[data.task_id] = data;
      }
    }
  } catch { /* ignore */ }
  return result;
}

/**
 * Read a queue item's logs.json (sync).
 */
function readQueueLogs(id) {
  return readJSON(path.join(getQueueDir(id), 'logs.json'));
}

/**
 * Read a queue item's logs.json (async).
 */
async function readQueueLogsAsync(id) {
  return readJSONAsync(path.join(getQueueDir(id), 'logs.json'));
}

/**
 * Read all progress files from a queue item's progress/ directory (async).
 */
async function readQueueProgressAsync(id) {
  const fsPromises = require('fs').promises;
  const progressDir = path.join(getQueueDir(id), 'progress');
  const result = {};
  try {
    const files = await fsPromises.readdir(progressDir);
    const reads = files
      .filter(f => f.endsWith('.json'))
      .map(async (file) => {
        const data = await readJSONAsync(path.join(progressDir, file));
        if (data && data.task_id) result[data.task_id] = data;
      });
    await Promise.all(reads);
  } catch { /* dir may not exist */ }
  return result;
}

/**
 * List all queue items with summary metadata for the popup.
 * Returns an array of { id, task, agentCount, status } objects.
 */
function listQueueSummaries() {
  const ids = listQueue();
  const summaries = [];
  for (const id of ids) {
    const init = readQueueInit(id);
    const progress = readQueueProgress(id);
    const hasTask = init && init.task && init.task.name;

    let status = 'pending';
    if (hasTask) {
      const progressValues = Object.values(progress);
      if (progressValues.length === 0) {
        status = 'pending';
      } else {
        let allDone = true;
        let hasFailed = false;
        let hasInProgress = false;
        let completed = 0;
        for (const p of progressValues) {
          if (p.status === 'in_progress') hasInProgress = true;
          if (p.status === 'failed') hasFailed = true;
          if (p.status === 'completed') completed++;
          if (p.status !== 'completed' && p.status !== 'failed') allDone = false;
        }
        const totalTasks = (init.task && init.task.total_tasks) || 0;
        if (totalTasks > 0 && progressValues.length < totalTasks) allDone = false;
        if (allDone && hasFailed) status = 'error';
        else if (allDone) status = 'completed';
        else if (hasInProgress || progressValues.length > 0) status = 'in_progress';
      }
    }

    summaries.push({
      id,
      task: hasTask ? {
        name: init.task.name,
        type: init.task.type || null,
        directory: init.task.directory || null,
        total_tasks: init.task.total_tasks || (init.agents ? init.agents.length : 0),
        created: init.task.created || null,
      } : null,
      agentCount: init && init.agents ? init.agents.length : 0,
      status,
    });
  }
  return summaries;
}

module.exports = {
  listQueue,
  getQueueDir,
  readQueueInit,
  readQueueInitAsync,
  readQueueProgress,
  readQueueProgressAsync,
  readQueueLogs,
  readQueueLogsAsync,
  listQueueSummaries,
};
