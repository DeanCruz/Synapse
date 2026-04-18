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
 * @param {string} [opts.projectPath] — target project directory
 * @param {string[]} [opts.additionalContextDirs] — additional read-only context directories
 * @returns {string}
 */
// Known dashboard-ID shapes: `ide` (reserved), 6-char hex, or legacy `dashboardN`.
// Garbage values here mean something upstream (master planning or IPC handler)
// passed a made-up path instead of the assigned dashboard ID.
var DASHBOARD_ID_SHAPE = /^(ide|[a-f0-9]{6}|dashboard[0-9]+)$/;

function buildSystemPrompt(opts) {
  // Defensive: the dashboardId threaded into the worker's system prompt must be
  // a real dashboard ID. If the master picked a wrong or made-up ID during
  // planning, we fail loudly here instead of silently routing every progress
  // file into the wrong dashboard directory.
  if (!opts || !opts.dashboardId) {
    throw new Error('PromptBuilder.buildSystemPrompt: opts.dashboardId is required');
  }
  if (!DASHBOARD_ID_SHAPE.test(opts.dashboardId)) {
    throw new Error(
      'PromptBuilder.buildSystemPrompt: opts.dashboardId=' + JSON.stringify(opts.dashboardId) +
      ' does not match a known dashboard ID shape (ide | 6-char hex | dashboardN). ' +
      'Refusing to dispatch a worker bound to a non-existent dashboard.'
    );
  }

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
  parts.push('- **Synapse_Instance_Location:** `' + opts.trackerRoot + '`');
  parts.push('- **DashboardID:** `' + opts.dashboardId + '`');
  parts.push('- **Synapse_Dashboard:** `' + opts.trackerRoot + '/dashboards/' + opts.dashboardId + '`');
  parts.push('- **Target_Directory:** `' + (opts.projectPath || 'N/A') + '`');

  var ctxDirs = opts.additionalContextDirs || [];
  if (ctxDirs.length > 0) {
    parts.push('- **Context_Directories:** `[' + ctxDirs.map(function(d) { return '"' + d + '"'; }).join(', ') + ']`');
  } else {
    parts.push('- **Context_Directories:** `[]`');
  }

  parts.push('');
  parts.push('### Path References (derived from above)');
  parts.push('- **tracker_root:** `' + opts.trackerRoot + '`');
  parts.push('- **dashboard_id:** `' + opts.dashboardId + '` — include this value as `"dashboard_id"` in every progress file write');
  parts.push('- **task_id:** `' + opts.taskId + '`');
  parts.push('- **progress_file:** `' + opts.trackerRoot + '/dashboards/' + opts.dashboardId + '/progress/' + opts.taskId + '.json`');
  parts.push('- **ide_dashboard:** `ide` (reserved — always exists, never use for swarms)');
  parts.push('');
  parts.push('**IMPORTANT:** Always use the Synapse_Instance_Location and Synapse_Dashboard paths above when writing progress files or updating dashboard state. Never assume a different Synapse directory.');

  // Additional context directories (read-only reference)
  var additionalDirs = opts.additionalContextDirs || [];
  if (additionalDirs.length > 0) {
    parts.push('');
    parts.push('## Additional Context Directories (READ-ONLY)');
    parts.push('The following directories are available as **read-only** reference material.');
    parts.push('You may read files in these directories for context, but you must **NEVER modify, create, or delete** any files in them.');
    parts.push('All code changes must happen in the project directory only.');
    parts.push('');
    for (var i = 0; i < additionalDirs.length; i++) {
      parts.push('- `' + additionalDirs[i] + '`');
    }
  }

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
 * @param {{ path: string, content: string }[]} [opts.additionalContextPaths] — read-only context from additional directories
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

  // Additional context directories (read-only reference)
  if (opts.additionalContextPaths && opts.additionalContextPaths.length > 0) {
    parts.push('## Additional Context (READ-ONLY)');
    parts.push('The following files are from **read-only** reference directories. Use them for context only — do NOT modify these files.');
    parts.push('');
    for (var k = 0; k < opts.additionalContextPaths.length; k++) {
      var actx = opts.additionalContextPaths[k];
      parts.push('### ' + actx.path);
      parts.push('```');
      var actxContent = actx.content;
      if (actxContent.length > 8000) {
        actxContent = actxContent.substring(0, 8000) + '\n\n... (truncated)';
      }
      parts.push(actxContent);
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

/**
 * Build a replan prompt for the CLI when the circuit breaker trips.
 * Gives the replanner full context: the original plan, what completed,
 * what failed (with error details), and what's still pending/blocked.
 *
 * The CLI must return a JSON object with:
 *   - modified: agents[] with updated fields (description, depends_on, title)
 *   - added: new agent entries to insert into the plan
 *   - removed: task IDs to remove from the plan (blocked tasks that are no longer viable)
 *   - summary: short explanation of what changed and why
 *
 * @param {object} opts
 * @param {string} opts.dashboardId
 * @param {object} opts.init — current initialization.json contents
 * @param {object} opts.progress — all progress files keyed by task_id
 * @param {object} opts.failedTasks — { taskId: true } map of failed task IDs
 * @param {object} opts.completedTasks — { taskId: true } map of completed task IDs
 * @param {number} opts.failedInWave — which wave triggered the circuit breaker
 * @returns {string}
 */
function buildReplanPrompt(opts) {
  var parts = [];

  parts.push('# Circuit Breaker Triggered — Replan Required');
  parts.push('');
  parts.push('The swarm on dashboard `' + opts.dashboardId + '` has hit the circuit breaker: 3+ task failures in Wave ' + opts.failedInWave + '.');
  parts.push('Your job is to analyze the failures, figure out what went wrong, and produce a revised plan.');
  parts.push('');

  // Original task info
  if (opts.init && opts.init.task) {
    parts.push('## Original Task');
    parts.push('- **Name:** ' + opts.init.task.name);
    parts.push('- **Prompt:** ' + (opts.init.task.prompt || 'N/A'));
    parts.push('- **Project:** ' + (opts.init.task.project_root || opts.init.task.directory || 'N/A'));
    parts.push('');
  }

  // Completed tasks
  var completedIds = Object.keys(opts.completedTasks || {});
  if (completedIds.length > 0) {
    parts.push('## Completed Tasks');
    for (var c = 0; c < completedIds.length; c++) {
      var cid = completedIds[c];
      var cAgent = findAgentInInit(opts.init, cid);
      var cProg = opts.progress[cid];
      parts.push('### Task ' + cid + ': ' + (cAgent ? cAgent.title : 'Unknown'));
      if (cProg && cProg.summary) {
        parts.push('**Summary:** ' + cProg.summary);
      }
      if (cProg && cProg.deviations && cProg.deviations.length > 0) {
        parts.push('**Deviations:**');
        for (var cd = 0; cd < cProg.deviations.length; cd++) {
          parts.push('- ' + cProg.deviations[cd].description);
        }
      }
      parts.push('');
    }
  }

  // Failed tasks (the critical section)
  var failedIds = Object.keys(opts.failedTasks || {});
  if (failedIds.length > 0) {
    parts.push('## Failed Tasks');
    for (var f = 0; f < failedIds.length; f++) {
      var fid = failedIds[f];
      var fAgent = findAgentInInit(opts.init, fid);
      var fProg = opts.progress[fid];
      parts.push('### Task ' + fid + ': ' + (fAgent ? fAgent.title : 'Unknown'));
      if (fAgent && fAgent.description) {
        parts.push('**Original description:** ' + fAgent.description);
      }
      if (fAgent && fAgent.depends_on && fAgent.depends_on.length > 0) {
        parts.push('**Dependencies:** ' + fAgent.depends_on.join(', '));
      }
      if (fProg) {
        if (fProg.summary) parts.push('**Error summary:** ' + fProg.summary);
        if (fProg.stage) parts.push('**Failed at stage:** ' + fProg.stage);
        if (fProg.message) parts.push('**Last message:** ' + fProg.message);
        if (fProg.logs && fProg.logs.length > 0) {
          parts.push('**Logs (last 10):**');
          var startIdx = Math.max(0, fProg.logs.length - 10);
          for (var fl = startIdx; fl < fProg.logs.length; fl++) {
            var log = fProg.logs[fl];
            parts.push('- [' + (log.level || 'info') + '] ' + log.msg);
          }
        }
        if (fProg.deviations && fProg.deviations.length > 0) {
          parts.push('**Deviations before failure:**');
          for (var fd = 0; fd < fProg.deviations.length; fd++) {
            parts.push('- ' + fProg.deviations[fd].description);
          }
        }
      }
      parts.push('');
    }
  }

  // Pending/blocked tasks
  parts.push('## Pending Tasks (not yet dispatched)');
  if (opts.init && opts.init.agents) {
    for (var p = 0; p < opts.init.agents.length; p++) {
      var pAgent = opts.init.agents[p];
      var pid = pAgent.id;
      if (opts.completedTasks[pid] || opts.failedTasks[pid]) continue;
      // Check if dispatched (in progress)
      if (opts.progress[pid] && opts.progress[pid].status === 'in_progress') continue;
      parts.push('- **Task ' + pid + ':** ' + pAgent.title);
      if (pAgent.depends_on && pAgent.depends_on.length > 0) {
        parts.push('  Dependencies: ' + pAgent.depends_on.join(', '));
      }
    }
  }
  parts.push('');

  // Full agent list for reference
  parts.push('## Full Current Plan (agents array from initialization.json)');
  parts.push('```json');
  parts.push(JSON.stringify(opts.init.agents || [], null, 2));
  parts.push('```');
  parts.push('');

  // Instructions for output format
  parts.push('## Your Output');
  parts.push('');
  parts.push('Analyze the failures and produce a revised plan. You MUST output ONLY a single JSON object (no markdown fences, no explanation outside the JSON). The format:');
  parts.push('');
  parts.push('```');
  parts.push('{');
  parts.push('  "summary": "Short explanation of what went wrong and what you changed",');
  parts.push('  "modified": [');
  parts.push('    {');
  parts.push('      "id": "2.1",');
  parts.push('      "title": "Updated title if needed",');
  parts.push('      "description": "Revised task description addressing the failure",');
  parts.push('      "depends_on": ["1.1"],');
  parts.push('      "wave": 2');
  parts.push('    }');
  parts.push('  ],');
  parts.push('  "added": [');
  parts.push('    {');
  parts.push('      "id": "2.1r",');
  parts.push('      "title": "Repair task title",');
  parts.push('      "description": "Full description of what this repair task should do",');
  parts.push('      "depends_on": ["1.1"],');
  parts.push('      "wave": 2,');
  parts.push('      "layer": 1');
  parts.push('    }');
  parts.push('  ],');
  parts.push('  "removed": ["3.2"],');
  parts.push('  "retry": ["2.1"]');
  parts.push('}');
  parts.push('```');
  parts.push('');
  parts.push('Rules:');
  parts.push('- "modified" updates existing tasks (only include fields you are changing, plus the id)');
  parts.push('- "added" creates new repair/replacement tasks. Use the failed task id with an "r" suffix (e.g. "2.1r"). New tasks must have id, title, description, depends_on, wave, and layer.');
  parts.push('- "removed" lists task IDs that should be dropped from the plan entirely (they are no longer viable or needed)');
  parts.push('- "retry" lists task IDs that should be retried as-is (the failure was transient, not a plan problem)');
  parts.push('- You can combine these: retry some tasks, modify others, add repair tasks, remove dead ends');
  parts.push('- Do NOT modify completed tasks');
  parts.push('- Rewire depends_on arrays so nothing points at a removed task');
  parts.push('- Keep wave numbers consistent with the dependency graph');
  parts.push('');
  parts.push('Output ONLY the JSON object. No other text.');

  return parts.join('\n');
}

/**
 * Build the system prompt for the replan CLI process.
 */
function buildReplanSystemPrompt() {
  var parts = [];
  parts.push('You are a swarm replanner for the Synapse agent coordination system.');
  parts.push('Your job is to analyze task failures in a parallel agent swarm and produce a revised execution plan.');
  parts.push('You are an expert at root cause analysis and dependency graph repair.');
  parts.push('You must output ONLY valid JSON. No markdown, no explanation, no preamble. Just the JSON object.');
  return parts.join('\n');
}

function findAgentInInit(init, taskId) {
  if (!init || !init.agents) return null;
  for (var i = 0; i < init.agents.length; i++) {
    if (init.agents[i].id === taskId) return init.agents[i];
  }
  return null;
}

module.exports = { buildSystemPrompt, buildTaskPrompt, readUpstreamResults, buildReplanPrompt, buildReplanSystemPrompt };
