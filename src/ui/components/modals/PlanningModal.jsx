// PlanningModal — AI-powered task planning from natural language prompt
// Spawns Claude Code planner worker, shows streaming output, then plan preview.

import React, { useState, useEffect, useRef } from 'react';
import Modal from './Modal.jsx';

function buildPlanningPrompt(userPrompt) {
  return (
    'Decompose this work request into parallel tasks for a swarm of Claude Code agents.\n\n' +
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
    '- Output ONLY the JSON — no markdown, no explanation'
  );
}

function extractJSON(text) {
  // First try direct parse of the accumulated text
  const jsonMatch = text.match(/\{[\s\S]*"task"[\s\S]*"agents"[\s\S]*\}/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch (e) { /* ignore */ }
  }
  // Parse NDJSON lines and extract text content from the real stream-json format
  const lines = text.split('\n');
  let combined = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      // Real format: {type:"assistant", message:{content:[{type:"text",text:"..."}]}}
      if (parsed.type === 'assistant' && parsed.message && parsed.message.content) {
        for (const block of parsed.message.content) {
          if (block.type === 'text') combined += block.text;
        }
      }
      // Also handle flat format just in case: {type:"assistant", content:[...]}
      else if (parsed.type === 'assistant' && parsed.content) {
        for (const block of parsed.content) {
          if (block.type === 'text') combined += block.text;
        }
      }
      // Final result message
      else if (parsed.type === 'result' && parsed.result) {
        combined += parsed.result;
      }
    } catch (e) {
      combined += trimmed;
    }
  }
  const finalMatch = combined.match(/\{[\s\S]*"task"[\s\S]*"agents"[\s\S]*\}/);
  if (finalMatch) {
    try { return JSON.parse(finalMatch[0]); } catch (e) { /* ignore */ }
  }
  return null;
}

function PlanPreview({ plan }) {
  return (
    <div className="planning-preview">
      <div className="planning-preview-name">{plan.task.name}</div>
      {(plan.waves || []).map(wave => (
        <div key={wave.id} className="planning-preview-wave">
          <div className="planning-preview-wave-title">{wave.name}</div>
          {(plan.agents || []).filter(a => a.wave === wave.id).map(agent => (
            <div key={agent.id} className="planning-preview-agent">
              <span className="planning-preview-id">{agent.id}</span>
              <span>{' ' + agent.title}</span>
              {agent.depends_on && agent.depends_on.length > 0 && (
                <span className="planning-preview-deps">
                  {' → ' + agent.depends_on.join(', ')}
                </span>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function PlanningModal({ onClose, dashboardId, projectPath, onPlanReady }) {
  const api = window.electronAPI || null;

  const [promptText, setPromptText] = useState('');
  const [generating, setGenerating] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [generatedPlan, setGeneratedPlan] = useState(null);
  const [error, setError] = useState('');

  const planOutputRef = useRef('');
  const outputListenerRef = useRef(null);
  const completeListenerRef = useRef(null);

  useEffect(() => {
    return () => {
      // Clean up listeners on unmount
      if (api && outputListenerRef.current) api.off('worker-output', outputListenerRef.current);
      if (api && completeListenerRef.current) api.off('worker-complete', completeListenerRef.current);
    };
  }, [api]);

  function handleGenerate() {
    const text = promptText.trim();
    if (!text) return;
    if (!api) {
      setError('Error: Desktop app required for AI planning');
      return;
    }

    setGenerating(true);
    setError('');
    setGeneratedPlan(null);
    setStatusMsg('Spawning Claude Code planner...');
    planOutputRef.current = '';

    const planPrompt = buildPlanningPrompt(text);

    api.spawnWorker({
      taskId: '_planner',
      dashboardId,
      projectDir: projectPath || null,
      prompt: planPrompt,
      systemPrompt: 'You are a task planner. Output ONLY valid JSON matching the initialization.json schema. No markdown, no explanation — just the JSON object.',
      model: 'sonnet',
      cliPath: null,
      dangerouslySkipPermissions: true,
    });

    outputListenerRef.current = api.on('worker-output', (data) => {
      if (data.taskId !== '_planner') return;
      planOutputRef.current += data.chunk;
      setStatusMsg('Generating plan... (' + planOutputRef.current.length + ' chars)');
    });

    completeListenerRef.current = api.on('worker-complete', (data) => {
      if (data.taskId !== '_planner') return;
      api.off('worker-output', outputListenerRef.current);
      api.off('worker-complete', completeListenerRef.current);
      outputListenerRef.current = null;
      completeListenerRef.current = null;

      setGenerating(false);

      try {
        const plan = extractJSON(planOutputRef.current);
        if (plan && plan.task && plan.agents) {
          setStatusMsg(
            'Plan generated: ' + plan.agents.length + ' tasks in ' +
            (plan.waves ? plan.waves.length : '?') + ' waves'
          );
          setGeneratedPlan(plan);
        } else {
          setError('Could not parse plan from output');
          setStatusMsg('');
        }
      } catch (e) {
        setError('Parse error: ' + e.message);
        setStatusMsg('');
      }
    });
  }

  function handleAcceptLaunch() {
    if (!generatedPlan || !onPlanReady) return;
    onClose();
    onPlanReady(generatedPlan);
  }

  function handleEditPlan() {
    if (!generatedPlan || !onPlanReady) return;
    onClose();
    onPlanReady(generatedPlan);
  }

  return (
    <Modal title="AI Task Planner" onClose={onClose}>
      <div className="settings-section">
        <div className="settings-section-title">Describe the work</div>
        <textarea
          className="settings-app-input task-editor-textarea"
          rows={8}
          placeholder={'Describe what you want to accomplish...\n\nExample: "Add user authentication with JWT tokens, create login/register pages, add middleware to protect API routes, and write integration tests"'}
          value={promptText}
          onChange={e => setPromptText(e.target.value)}
          autoFocus
        />
        {projectPath && (
          <div className="settings-app-note">Project: {projectPath}</div>
        )}
      </div>

      <button
        className="project-pick-btn"
        onClick={handleGenerate}
        disabled={generating || !promptText.trim()}
      >
        {generating ? 'Generating...' : (generatedPlan ? 'Regenerate' : 'Generate Plan')}
      </button>

      {statusMsg && (
        <div className="planning-status">{statusMsg}</div>
      )}

      {error && (
        <div className="planning-status" style={{ color: 'var(--color-failed)' }}>
          Error: {error}
        </div>
      )}

      {generatedPlan && (
        <div className="settings-section">
          <div className="settings-section-title">Generated Plan</div>
          <PlanPreview plan={generatedPlan} />
          <div className="task-editor-buttons" style={{ marginTop: '16px' }}>
            <button className="settings-custom-reset-btn" onClick={handleEditPlan}>
              Edit Plan
            </button>
            <button className="project-pick-btn" onClick={handleAcceptLaunch}>
              Accept &amp; Launch
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
