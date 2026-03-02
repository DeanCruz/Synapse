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
  // Must have task (null or object) and agents (array)
  if (!('task' in data)) return false;
  if (data.task !== null && typeof data.task !== 'object') return false;
  if (!Array.isArray(data.agents)) return false;
  return true;
}

function isValidProgress(data) {
  if (!data || typeof data !== 'object') return false;
  if (typeof data.task_id !== 'string') return false;
  if (typeof data.status !== 'string') return false;
  return true;
}

module.exports = {
  readJSON,
  readJSONAsync,
  readJSONWithRetry,
  isValidInitialization,
  isValidProgress,
};
