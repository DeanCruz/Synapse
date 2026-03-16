// WorkerTerminalModal — Live streaming output view for a worker agent
// ES module. Shows real-time Claude Code CLI output in a conversation-style view
// with full tool call rendering (names, parameters, results).

import { el } from '../../utils/dom.js';
import { createModalPopup } from './ModalFactory.js';
import { renderMarkdown } from '../../utils/markdown.js';

/**
 * Render a tool_use block as a collapsible DOM element.
 * Shows tool name, input parameters, and (when available) results.
 */
function renderToolUseBlock(block) {
  var wrapper = el('div', { className: 'claude-tool-call' });

  // Tool header — name + toggle
  var header = el('div', { className: 'claude-tool-header' });
  var icon = el('span', { className: 'claude-tool-icon', text: '\u2699' });
  var name = el('span', { className: 'claude-tool-name', text: block.name });
  var toggle = el('span', { className: 'claude-tool-toggle', text: '\u25B6' });
  header.appendChild(icon);
  header.appendChild(name);
  header.appendChild(toggle);
  wrapper.appendChild(header);

  // Collapsible body with input params
  var body = el('div', { className: 'claude-tool-body', style: { display: 'none' } });

  if (block.input) {
    var inputLabel = el('div', { className: 'claude-tool-label', text: 'Input:' });
    body.appendChild(inputLabel);
    var inputPre = el('pre', { className: 'claude-tool-input' });
    try {
      inputPre.textContent = typeof block.input === 'string'
        ? block.input
        : JSON.stringify(block.input, null, 2);
    } catch (e) {
      inputPre.textContent = String(block.input);
    }
    body.appendChild(inputPre);
  }

  wrapper.appendChild(body);

  // Toggle expand/collapse
  header.addEventListener('click', function () {
    var isOpen = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : 'block';
    toggle.textContent = isOpen ? '\u25B6' : '\u25BC';
    wrapper.classList.toggle('expanded', !isOpen);
  });

  // Store tool_use_id for matching results later
  wrapper._toolId = block.id || null;
  wrapper._body = body;

  return wrapper;
}

/**
 * Render a tool_result into an existing tool call block.
 */
function appendToolResult(toolWrapper, resultContent) {
  var body = toolWrapper._body;
  if (!body) return;

  var resultLabel = el('div', { className: 'claude-tool-label claude-tool-result-label', text: 'Result:' });
  body.appendChild(resultLabel);

  var resultPre = el('pre', { className: 'claude-tool-result' });
  if (typeof resultContent === 'string') {
    resultPre.textContent = resultContent;
  } else if (Array.isArray(resultContent)) {
    // tool_result content is usually an array of blocks
    var text = resultContent.map(function (b) {
      if (b.type === 'text') return b.text;
      return JSON.stringify(b, null, 2);
    }).join('\n');
    resultPre.textContent = text;
  } else {
    try {
      resultPre.textContent = JSON.stringify(resultContent, null, 2);
    } catch (e) {
      resultPre.textContent = String(resultContent);
    }
  }
  body.appendChild(resultPre);
}

/**
 * Show a live terminal/conversation view for a worker agent's output.
 *
 * @param {object} opts
 * @param {string} opts.taskId — task being monitored
 * @param {string} opts.title — modal title
 * @param {number} [opts.pid] — worker PID (for kill button)
 */
export function showWorkerTerminal(opts) {
  var popup = createModalPopup('worker-terminal-overlay', 'Live Output \u2014 ' + (opts.title || opts.taskId));
  var body = popup.body;

  var api = window.electronAPI;

  // Conversation container (replaces plain terminal)
  var conversation = el('div', { className: 'claude-conversation' });
  body.appendChild(conversation);

  // Map of tool_use_id -> DOM element for result matching
  var toolCallMap = {};

  // Controls
  var controls = el('div', { className: 'worker-terminal-controls' });

  if (opts.pid) {
    var killBtn = el('button', { className: 'settings-custom-reset-btn', text: 'Kill Worker' });
    killBtn.addEventListener('click', function () {
      if (api) {
        api.killWorker(opts.pid);
        var killMsg = el('div', { className: 'claude-system-msg claude-error', text: '[KILLED]' });
        conversation.appendChild(killMsg);
        killBtn.disabled = true;
      }
    });
    controls.appendChild(killBtn);
  }

  var clearBtn = el('button', { className: 'settings-custom-reset-btn', text: 'Clear' });
  clearBtn.addEventListener('click', function () {
    conversation.innerHTML = '';
    toolCallMap = {};
  });
  controls.appendChild(clearBtn);

  body.appendChild(controls);

  // Current text accumulator — batches text blocks into one bubble
  var currentTextEl = null;

  function flushText() {
    currentTextEl = null;
  }

  function appendText(text) {
    if (!currentTextEl) {
      currentTextEl = el('div', { className: 'claude-message claude-assistant' });
      var textContent = el('div', { className: 'claude-message-text' });
      currentTextEl.appendChild(textContent);
      conversation.appendChild(currentTextEl);
      currentTextEl._textEl = textContent;
      currentTextEl._rawText = '';
    }
    currentTextEl._rawText += text;
    currentTextEl._textEl.innerHTML = renderMarkdown(currentTextEl._rawText);
  }

  // Listen for worker output
  var listener = null;
  var completeListener = null;

  if (api) {
    listener = api.on('worker-output', function (data) {
      if (data.taskId !== opts.taskId) return;

      var lines = data.chunk.split('\n');
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) continue;
        try {
          var parsed = JSON.parse(line);

          if (parsed.type === 'assistant' && parsed.content) {
            for (var c = 0; c < parsed.content.length; c++) {
              var block = parsed.content[c];
              if (block.type === 'text') {
                appendText(block.text);
              } else if (block.type === 'tool_use') {
                flushText();
                var toolEl = renderToolUseBlock(block);
                conversation.appendChild(toolEl);
                if (block.id) {
                  toolCallMap[block.id] = toolEl;
                }
              }
            }
          } else if (parsed.type === 'content_block_start') {
            // Streaming content block start
            if (parsed.content_block && parsed.content_block.type === 'tool_use') {
              flushText();
              var toolEl2 = renderToolUseBlock(parsed.content_block);
              conversation.appendChild(toolEl2);
              if (parsed.content_block.id) {
                toolCallMap[parsed.content_block.id] = toolEl2;
              }
            }
          } else if (parsed.type === 'tool_result') {
            flushText();
            // Match to the tool_use block
            var targetId = parsed.tool_use_id;
            if (targetId && toolCallMap[targetId]) {
              appendToolResult(toolCallMap[targetId], parsed.content);
            } else {
              // No matching tool_use — render standalone
              var resultDiv = el('div', { className: 'claude-tool-result-standalone' });
              var resultPre = el('pre', { className: 'claude-tool-result' });
              if (typeof parsed.content === 'string') {
                resultPre.textContent = parsed.content;
              } else {
                try {
                  resultPre.textContent = JSON.stringify(parsed.content, null, 2);
                } catch (e) {
                  resultPre.textContent = String(parsed.content);
                }
              }
              resultDiv.appendChild(resultPre);
              conversation.appendChild(resultDiv);
            }
          } else if (parsed.type === 'result') {
            flushText();
            if (parsed.result) {
              var resultMsg = el('div', { className: 'claude-message claude-result' });
              var resultText = el('div', { className: 'claude-message-text' });
              resultText.innerHTML = renderMarkdown(parsed.result);
              resultMsg.appendChild(resultText);
              conversation.appendChild(resultMsg);
            }
          } else if (parsed.type === 'system') {
            flushText();
            var sysMsg = el('div', { className: 'claude-system-msg', text: parsed.message || JSON.stringify(parsed) });
            conversation.appendChild(sysMsg);
          }
        } catch (e) {
          // Plain text output
          appendText(line + '\n');
        }
      }
      // Auto-scroll
      conversation.scrollTop = conversation.scrollHeight;
    });

    completeListener = api.on('worker-complete', function (data) {
      if (data.taskId !== opts.taskId) return;
      flushText();
      var doneMsg = el('div', { className: 'claude-system-msg' });
      doneMsg.textContent = '\u2014\u2014\u2014 Worker finished (exit code: ' + data.exitCode + ') \u2014\u2014\u2014';
      conversation.appendChild(doneMsg);
      if (data.errorOutput) {
        var errMsg = el('div', { className: 'claude-system-msg claude-error' });
        errMsg.textContent = '[stderr] ' + data.errorOutput;
        conversation.appendChild(errMsg);
      }
      conversation.scrollTop = conversation.scrollHeight;
    });
  }

  // Clean up listeners when modal closes
  var origRemove = popup.overlay.remove.bind(popup.overlay);
  popup.overlay.remove = function () {
    if (api && listener) api.off('worker-output', listener);
    if (api && completeListener) api.off('worker-complete', completeListener);
    origRemove();
  };

  document.body.appendChild(popup.overlay);
}
