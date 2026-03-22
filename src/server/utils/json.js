const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const { PROGRESS_RETRY_MS } = require('./constants');

// --- File Reading Helpers ---

function readJSON(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err instanceof SyntaxError) {
      console.error(`[readJSON] Malformed JSON in ${path.basename(filePath)}: ${err.message}`);
    }
    return null;
  }
}

async function readJSONAsync(filePath) {
  try {
    const raw = await fsPromises.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err instanceof SyntaxError) {
      console.error(`[readJSON] Malformed JSON in ${path.basename(filePath)}: ${err.message}`);
    }
    return null;
  }
}

/**
 * Read a JSON file with retry — used for progress files that may be mid-write.
 * Retries once after a short delay if the first read yields invalid JSON.
 */
function readJSONWithRetry(filePath, retryDelayMs) {
  return new Promise((resolve) => {
    const first = readJSON(filePath);
    if (first !== null) return resolve(first);
    // Retry after delay (file may have been mid-write)
    setTimeout(() => {
      resolve(readJSON(filePath));
    }, retryDelayMs || PROGRESS_RETRY_MS);
  });
}

// --- Schema Validation ---

function isValidInitialization(data) {
  if (!data || typeof data !== 'object') return false;

  // task must be null (empty dashboard) or an object
  if (!('task' in data)) return false;
  if (data.task !== null && typeof data.task !== 'object') return false;

  // agents must be an array
  if (!Array.isArray(data.agents)) return false;

  // If task is not null, validate required task fields
  if (data.task !== null) {
    if (typeof data.task.name !== 'string' || data.task.name.length === 0) return false;
    if (typeof data.task.type !== 'string') return false;

    // type must be Waves or Chains
    const VALID_TYPES = ['Waves', 'Chains'];
    if (!VALID_TYPES.includes(data.task.type)) return false;

    // total_tasks and total_waves should be numbers or strings if present
    if (data.task.total_tasks !== undefined && typeof data.task.total_tasks !== 'number' && typeof data.task.total_tasks !== 'string') return false;
    if (data.task.total_waves !== undefined && typeof data.task.total_waves !== 'number' && typeof data.task.total_waves !== 'string') return false;
  }

  // Validate agents array entries (if non-empty, each must have id and title)
  for (const agent of data.agents) {
    if (!agent || typeof agent !== 'object') return false;
    if (typeof agent.id !== 'string' || agent.id.length === 0) return false;
    if (typeof agent.title !== 'string' || agent.title.length === 0) return false;
  }

  // Validate waves array (if present)
  if (data.waves !== undefined) {
    if (!Array.isArray(data.waves)) return false;
    for (const wave of data.waves) {
      if (!wave || typeof wave !== 'object') return false;
      if (wave.id === undefined || wave.id === null) return false;
      if (typeof wave.name !== 'string' || wave.name.length === 0) return false;
    }
  }

  return true;
}

function isValidProgress(data) {
  if (!data || typeof data !== 'object') return false;

  // Required string fields
  if (typeof data.task_id !== 'string' || data.task_id.length === 0) return false;
  if (typeof data.status !== 'string') return false;

  // Status must be one of the valid values
  const VALID_STATUSES = ['in_progress', 'completed', 'failed'];
  if (!VALID_STATUSES.includes(data.status)) return false;

  // Stage validation (if present)
  if (data.stage !== undefined && data.stage !== null) {
    const VALID_STAGES = ['reading_context', 'planning', 'implementing', 'testing', 'finalizing', 'completed', 'failed'];
    if (typeof data.stage !== 'string' || !VALID_STAGES.includes(data.stage)) return false;
  }

  // Timestamp validation (if present, must be string or null)
  if (data.started_at !== undefined && data.started_at !== null && typeof data.started_at !== 'string') return false;
  if (data.completed_at !== undefined && data.completed_at !== null && typeof data.completed_at !== 'string') return false;

  // completed_at should be null when status is in_progress
  if (data.status === 'in_progress' && data.completed_at !== undefined && data.completed_at !== null) return false;

  // Array fields (if present, must be arrays)
  if (data.milestones !== undefined && !Array.isArray(data.milestones)) return false;
  if (data.deviations !== undefined && !Array.isArray(data.deviations)) return false;
  if (data.logs !== undefined && !Array.isArray(data.logs)) return false;

  return true;
}

function isValidLogs(data) {
  if (!data || typeof data !== 'object') return false;
  if (!Array.isArray(data.entries)) return false;
  return true;
}

module.exports = {
  readJSON,
  readJSONAsync,
  readJSONWithRetry,
  isValidInitialization,
  isValidProgress,
  isValidLogs,
};
