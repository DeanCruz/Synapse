// PlanningModal — AI-powered task planning from natural language
// ES module. Prompt input, generates plan via Claude Code, preview + launch.

import { el } from '../../utils/dom.js';
import { createModalPopup } from './ModalFactory.js';

/**
 * Show the AI planning modal.
 *
 * @param {object} opts
 * @param {string} opts.dashboardId — target dashboard
 * @param {string} [opts.projectPath] — project directory for context
 * @param {function} opts.onPlanReady — callback(initData) when plan is accepted
 */
export function showPlanningModal(opts) {
  var popup = createModalPopup('planning-overlay', 'AI Task Planner');
  var body = popup.body;

  var api = window.electronAPI;

  // Prompt input
  var promptSection = el('div', { className: 'settings-section' });
  promptSection.appendChild(el('div', { className: 'settings-section-title', text: 'Describe the work' }));

  var promptArea = document.createElement('textarea');
  promptArea.className = 'settings-app-input task-editor-textarea';
  promptArea.rows = 8;
  promptArea.placeholder = 'Describe what you want to accomplish...\n\nExample: "Add user authentication with JWT tokens, create login/register pages, add middleware to protect API routes, and write integration tests"';
  promptSection.appendChild(promptArea);

  // Project context indicator
  if (opts.projectPath) {
    var ctxNote = el('div', { className: 'settings-app-note', text: 'Project: ' + opts.projectPath });
    promptSection.appendChild(ctxNote);
  }

  body.appendChild(promptSection);

  // Generate button
  var generateBtn = el('button', { className: 'project-pick-btn', text: 'Generate Plan' });
  var statusMsg = el('div', { className: 'planning-status' });
  statusMsg.hidden = true;

  // Preview section (hidden until plan generated)
  var previewSection = el('div', { className: 'settings-section' });
  previewSection.hidden = true;

  var previewTitle = el('div', { className: 'settings-section-title', text: 'Generated Plan' });
  previewSection.appendChild(previewTitle);
  var previewBody = el('div', { className: 'planning-preview' });
  previewSection.appendChild(previewBody);

  // Action buttons
  var actionRow = el('div', { className: 'task-editor-buttons' });
  actionRow.hidden = true;

  var editBtn = el('button', { className: 'settings-custom-reset-btn', text: 'Edit Plan' });
  var launchBtn = el('button', { className: 'project-pick-btn', text: 'Accept & Launch' });

  actionRow.appendChild(editBtn);
  actionRow.appendChild(launchBtn);

  generateBtn.addEventListener('click', function () {
    var prompt = promptArea.value.trim();
    if (!prompt) { promptArea.focus(); return; }

    generateBtn.disabled = true;
    generateBtn.textContent = 'Generating...';
    statusMsg.textContent = 'Spawning Claude Code planner...';
    statusMsg.hidden = false;
    previewSection.hidden = true;
    actionRow.hidden = true;

    // Build a planning prompt
    var planPrompt = buildPlanningPrompt(prompt, opts.dashboardId);

    if (!api) {
      statusMsg.textContent = 'Error: Desktop app required for AI planning';
      generateBtn.disabled = false;
      generateBtn.textContent = 'Generate Plan';
      return;
    }

    // Spawn a Claude Code process for planning
    api.spawnWorker({
      taskId: '_planner',
      dashboardId: opts.dashboardId,
      projectDir: opts.projectPath || null,
      prompt: planPrompt,
      systemPrompt: 'You are a task planner. Output ONLY valid JSON matching the initialization.json schema. No markdown, no explanation — just the JSON object.',
      model: 'sonnet',
      cliPath: null, // Use default
      dangerouslySkipPermissions: true,
    });

    // Collect output
    var planOutput = '';
    var outputListener = api.on('worker-output', function (data) {
      if (data.taskId === '_planner') {
        planOutput += data.chunk;
        statusMsg.textContent = 'Generating plan... (' + planOutput.length + ' chars)';
      }
    });

    var completeListener = api.on('worker-complete', function (data) {
      if (data.taskId !== '_planner') return;
      api.off('worker-output', outputListener);
      api.off('worker-complete', completeListener);

      generateBtn.disabled = false;
      generateBtn.textContent = 'Regenerate';

      // Try to parse the plan
      try {
        var plan = extractJSON(planOutput);
        if (plan && plan.task && plan.agents) {
          statusMsg.textContent = 'Plan generated: ' + plan.agents.length + ' tasks in ' + (plan.waves ? plan.waves.length : '?') + ' waves';
          renderPreview(previewBody, plan);
          previewSection.hidden = false;
          actionRow.hidden = false;

          launchBtn.onclick = function () {
            popup.overlay.remove();
            if (opts.onPlanReady) opts.onPlanReady(plan);
          };

          editBtn.onclick = function () {
            popup.overlay.remove();
            if (opts.onPlanReady) opts.onPlanReady(plan);
          };
        } else {
          statusMsg.textContent = 'Error: Could not parse plan from output';
        }
      } catch (e) {
        statusMsg.textContent = 'Error: ' + e.message;
      }
    });
  });

  body.appendChild(generateBtn);
  body.appendChild(statusMsg);
  body.appendChild(previewSection);
  body.appendChild(actionRow);

  document.body.appendChild(popup.overlay);
  promptArea.focus();
}

function buildPlanningPrompt(userPrompt, dashboardId) {
  return 'Decompose this work request into parallel tasks for a swarm of Claude Code agents.\n\n' +
    'User request: ' + userPrompt + '\n\n' +
    'Output a JSON object with this exact structure:\n' +
    '{\n' +
    '  "task": { "name": "...", "type": "Waves", "directory": ".", "prompt": "...", "project": "...", "created": "ISO timestamp", "total_tasks": N, "total_waves": N },\n' +
    '  "agents": [{ "id": "1.1", "title": "...", "wave": 1, "layer": "...", "directory": ".", "depends_on": [], "description": "..." }],\n' +
    '  "waves": [{ "id": 1, "name": "Wave 1 — ...", "total": N }],\n' +
    '  "chains": [],\n' +
    '  "history": []\n' +
    '}\n\n' +
    'Rules:\n' +
    '- Task IDs use format "wave.index" (e.g. 1.1, 1.2, 2.1)\n' +
    '- Tasks can only depend on tasks from earlier waves\n' +
    '- Each task should take 1-5 minutes for a single agent\n' +
    '- Include a "description" field with detailed instructions for each agent\n' +
    '- Output ONLY the JSON — no markdown, no explanation';
}

function extractJSON(text) {
  // Try to find JSON in the output (may be wrapped in stream-json format)
  var jsonMatch = text.match(/\{[\s\S]*"task"[\s\S]*"agents"[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }
  // Try parsing lines as stream-json
  var lines = text.split('\n');
  var combined = '';
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    try {
      var parsed = JSON.parse(line);
      if (parsed.type === 'assistant' && parsed.content) {
        for (var c = 0; c < parsed.content.length; c++) {
          if (parsed.content[c].type === 'text') {
            combined += parsed.content[c].text;
          }
        }
      } else if (parsed.type === 'result' && parsed.result) {
        combined += parsed.result;
      }
    } catch (e) {
      combined += line;
    }
  }
  var finalMatch = combined.match(/\{[\s\S]*"task"[\s\S]*"agents"[\s\S]*\}/);
  if (finalMatch) return JSON.parse(finalMatch[0]);
  return null;
}

function renderPreview(container, plan) {
  container.textContent = '';

  var taskName = el('div', { className: 'planning-preview-name', text: plan.task.name });
  container.appendChild(taskName);

  for (var w = 0; w < plan.waves.length; w++) {
    var wave = plan.waves[w];
    var waveEl = el('div', { className: 'planning-preview-wave' });
    waveEl.appendChild(el('div', { className: 'planning-preview-wave-title', text: wave.name }));

    // Find agents in this wave
    for (var a = 0; a < plan.agents.length; a++) {
      if (plan.agents[a].wave === wave.id) {
        var agentEl = el('div', { className: 'planning-preview-agent' });
        agentEl.appendChild(el('span', { className: 'planning-preview-id', text: plan.agents[a].id }));
        agentEl.appendChild(el('span', { text: ' ' + plan.agents[a].title }));
        if (plan.agents[a].depends_on && plan.agents[a].depends_on.length > 0) {
          agentEl.appendChild(el('span', { className: 'planning-preview-deps', text: ' → ' + plan.agents[a].depends_on.join(', ') }));
        }
        waveEl.appendChild(agentEl);
      }
    }

    container.appendChild(waveEl);
  }
}
