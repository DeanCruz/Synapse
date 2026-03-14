// electron/services/PromptBuilder.js — Constructs worker prompts with full context
// Combines task description, project context, upstream results, and worker instructions.

const fs = require('fs');
const path = require('path');

const { ROOT } = require('../../src/server/utils/constants');

var WORKER_INSTRUCTIONS_PATH = path.join(ROOT, 'agent', 'instructions', 'tracker_worker_instructions.md');

/**
 * Build the system prompt for a worker agent.
 * This is appended via --append-system-prompt and contains the progress reporting protocol.
 *
 * @param {object} opts
 * @param {string} opts.taskId
 * @param {string} opts.dashboardId
 * @param {string} opts.trackerRoot — path to Synapse root
 * @returns {string}
 */
function buildSystemPrompt(opts) {
  var parts = [];

  // Load worker instructions
  try {
    var instructions = fs.readFileSync(WORKER_INSTRUCTIONS_PATH, 'utf-8');
    parts.push(instructions);
  } catch (e) {
    parts.push('# Worker Progress Reporting\nWrite progress to: ' + opts.trackerRoot + '/dashboards/' + opts.dashboardId + '/progress/' + opts.taskId + '.json');
  }

  // Add concrete paths
  parts.push('\n---\n');
  parts.push('## Your Dispatch Context\n');
  parts.push('- **tracker_root:** `' + opts.trackerRoot + '`');
  parts.push('- **dashboardId:** `' + opts.dashboardId + '`');
  parts.push('- **task_id:** `' + opts.taskId + '`');
  parts.push('- **progress_file:** `' + opts.trackerRoot + '/dashboards/' + opts.dashboardId + '/progress/' + opts.taskId + '.json`');

  return parts.join('\n');
}

/**
 * Build the task prompt for a worker agent.
 * This is the main prompt passed as the final argument to claude CLI.
 *
 * @param {object} opts
 * @param {object} opts.task — the agent entry from initialization.json
 * @param {string} [opts.taskDescription] — additional description/context
 * @param {{ path: string, content: string }[]} [opts.projectContexts] — CLAUDE.md contents
 * @param {{ taskId: string, summary: string, files?: string[] }[]} [opts.upstreamResults] — completed dependency results
 * @returns {string}
 */
function buildTaskPrompt(opts) {
  var parts = [];

  parts.push('# Task ' + opts.task.id + ': ' + opts.task.title);
  parts.push('');

  if (opts.task.directory) {
    parts.push('**Working directory:** `' + opts.task.directory + '`');
    parts.push('');
  }

  // Task description
  if (opts.taskDescription) {
    parts.push('## Task Description');
    parts.push(opts.taskDescription);
    parts.push('');
  }

  // Project context (CLAUDE.md files)
  if (opts.projectContexts && opts.projectContexts.length > 0) {
    parts.push('## Project Context');
    for (var i = 0; i < opts.projectContexts.length; i++) {
      var ctx = opts.projectContexts[i];
      parts.push('### ' + path.basename(path.dirname(ctx.path)) + '/CLAUDE.md');
      parts.push('```');
      // Truncate very long CLAUDE.md to avoid context overflow
      var content = ctx.content;
      if (content.length > 8000) {
        content = content.substring(0, 8000) + '\n\n... (truncated)';
      }
      parts.push(content);
      parts.push('```');
      parts.push('');
    }
  }

  // Upstream results
  if (opts.upstreamResults && opts.upstreamResults.length > 0) {
    parts.push('## Upstream Task Results');
    parts.push('The following tasks have completed before yours. Use their results as context:');
    parts.push('');
    for (var j = 0; j < opts.upstreamResults.length; j++) {
      var upstream = opts.upstreamResults[j];
      parts.push('### Task ' + upstream.taskId);
      parts.push('**Summary:** ' + (upstream.summary || 'No summary available'));
      if (upstream.files && upstream.files.length > 0) {
        parts.push('**Files changed:** ' + upstream.files.join(', '));
      }
      if (upstream.deviations && upstream.deviations.length > 0) {
        parts.push('**Deviations:**');
        for (var d = 0; d < upstream.deviations.length; d++) {
          parts.push('- [' + upstream.deviations[d].severity + '] ' + upstream.deviations[d].description);
        }
      }
      parts.push('');
    }
  }

  return parts.join('\n');
}

/**
 * Read upstream results from completed progress files.
 *
 * @param {string} dashboardId
 * @param {string[]} dependsOn — list of task IDs this task depends on
 * @param {string} trackerRoot
 * @returns {{ taskId, summary, deviations }[]}
 */
function readUpstreamResults(dashboardId, dependsOn, trackerRoot) {
  var results = [];
  for (var i = 0; i < dependsOn.length; i++) {
    var progressFile = path.join(trackerRoot, 'dashboards', dashboardId, 'progress', dependsOn[i] + '.json');
    try {
      var data = JSON.parse(fs.readFileSync(progressFile, 'utf-8'));
      results.push({
        taskId: data.task_id,
        summary: data.summary,
        deviations: data.deviations || [],
      });
    } catch (e) {
      results.push({
        taskId: dependsOn[i],
        summary: '(progress file not found)',
        deviations: [],
      });
    }
  }
  return results;
}

module.exports = { buildSystemPrompt, buildTaskPrompt, readUpstreamResults };
