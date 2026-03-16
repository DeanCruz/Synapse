// ClaudeView — Full Claude Code frontend embedded in the dashboard
// ES module. Renders a conversation view with prompt bar, tool call rendering,
// streaming output, and multi-session management with save/load/switch.

import { el } from '../utils/dom.js';
import { renderMarkdown } from '../utils/markdown.js';

export function renderClaudeView(opts) {
  var container = opts.container;
  container.innerHTML = '';

  var api = window.electronAPI;

  // Main wrapper
  var wrapper = el('div', { className: 'claude-view' });

  // ── Header bar ──────────────────────────────────────────────────────────────
  var header = el('div', { className: 'claude-view-header' });
  var headerTitle = el('span', { className: 'claude-view-title', text: 'Claude Code' });
  header.appendChild(headerTitle);

  var statusBadge = el('span', { className: 'claude-view-status', text: 'Ready' });
  header.appendChild(statusBadge);

  if (opts.onClose) {
    var closeBtn = el('button', { className: 'claude-view-close', text: '\u2715' });
    closeBtn.addEventListener('click', opts.onClose);
    header.appendChild(closeBtn);
  }
  wrapper.appendChild(header);

  // ── Session toolbar (between header and conversation) ───────────────────────
  var sessionToolbar = el('div', { className: 'claude-session-toolbar' });
  var newBtn = el('button', { className: 'claude-session-new-btn', text: '+ New' });
  sessionToolbar.appendChild(newBtn);
  wrapper.appendChild(sessionToolbar);

  // ── Conversation area ───────────────────────────────────────────────────────
  var conversation = el('div', { className: 'claude-conversation claude-view-conversation' });
  var welcomeMsg = el('div', { className: 'claude-system-msg' });
  welcomeMsg.textContent = 'Claude Code is ready. Type a message below to start.';
  conversation.appendChild(welcomeMsg);
  wrapper.appendChild(conversation);

  // ── Quick action chips ───────────────────────────────────────────────────────
  var quickActions = el('div', { className: 'claude-quick-actions' });
  var actionDefs = [
    { label: 'New Swarm', fn: opts.onNewSwarm },
    { label: 'AI Plan',   fn: opts.onAIPlan   },
    { label: 'Launch',    fn: opts.onLaunch   },
    { label: 'Pause',     fn: opts.onPause    },
    { label: 'Cancel',    fn: opts.onCancel   },
  ];
  actionDefs.forEach(function (action) {
    if (!action.fn) return;
    var btn = el('button', { className: 'claude-quick-action-btn', text: action.label });
    btn.addEventListener('click', action.fn);
    quickActions.appendChild(btn);
  });
  wrapper.appendChild(quickActions);

  // ── Prompt bar ──────────────────────────────────────────────────────────────
  var promptBar = el('div', { className: 'claude-prompt-bar' });
  var promptInput = el('textarea', {
    className: 'claude-prompt-input',
    attrs: { placeholder: 'Ask Claude anything...', rows: '1' },
  });
  var sendBtn = el('button', { className: 'claude-send-btn', text: 'Send' });
  var modelSelect = el('select', { className: 'claude-model-select' });
  var models = [
    { value: 'sonnet', label: 'Sonnet' },
    { value: 'opus', label: 'Opus' },
    { value: 'haiku', label: 'Haiku' },
  ];
  models.forEach(function (m) {
    var opt = el('option', { text: m.label, attrs: { value: m.value } });
    modelSelect.appendChild(opt);
  });

  promptBar.appendChild(modelSelect);
  promptBar.appendChild(promptInput);
  promptBar.appendChild(sendBtn);
  wrapper.appendChild(promptBar);

  container.appendChild(wrapper);

  // ── Core worker state ───────────────────────────────────────────────────────
  var activeWorkerTaskId = null;
  var toolCallMap = {};
  var currentTextEl = null;
  var workerListener = null;
  var completeListener = null;
  var isProcessing = false;

  // ── Session state ───────────────────────────────────────────────────────────
  var currentConvId = null;          // id of active conversation
  var currentConvName = 'Session';   // name of active conversation
  var currentConvCreated = null;     // ISO string of creation time
  var currentMessages = [];          // [{role:'user'|'assistant', content:string, timestamp:string}]
  var pendingAssistantText = '';     // accumulates streaming text for the current turn

  var MAX_CHIPS = 6;

  // ── Session toolbar rendering ───────────────────────────────────────────────

  function refreshToolbar() {
    if (!api || !api.listConversations) return;
    api.listConversations().then(function (data) {
      var convs = (data && data.conversations) ? data.conversations : [];
      renderChips(convs);
    }).catch(function () {
      renderChips([]);
    });
  }

  function renderChips(convs) {
    // Remove all children after the "+ New" button
    var children = Array.prototype.slice.call(sessionToolbar.children);
    for (var i = 1; i < children.length; i++) {
      children[i].remove();
    }

    // Sort newest-first, cap at MAX_CHIPS
    var sorted = convs.slice().sort(function (a, b) {
      var ta = b.updated || b.created || '';
      var tb = a.updated || a.created || '';
      return ta > tb ? 1 : ta < tb ? -1 : 0;
    });

    var visible = sorted.slice(0, MAX_CHIPS);
    var hasOverflow = sorted.length > MAX_CHIPS;

    visible.forEach(function (conv) {
      var chip = makeChip(conv);
      sessionToolbar.appendChild(chip);
    });

    if (hasOverflow) {
      var overflowBtn = el('button', { className: 'claude-session-overflow', text: '\u00B7\u00B7\u00B7' });
      sessionToolbar.appendChild(overflowBtn);
    }
  }

  function makeChip(conv) {
    var isActive = conv.id === currentConvId;
    var chip = el('div', { className: 'claude-session-chip' + (isActive ? ' active' : '') });
    chip.dataset.convId = conv.id;

    // Active dot indicator
    var dot = el('span', { className: 'claude-session-dot' });
    chip.appendChild(dot);

    // Session name label
    var label = el('span', { className: 'claude-session-label' });
    label.textContent = conv.name || 'Session';
    chip.appendChild(label);

    // Delete button (visible on hover via CSS)
    var delBtn = el('button', { className: 'claude-session-delete', text: '\u00D7' });
    chip.appendChild(delBtn);

    // Click chip body (not delete button) to switch
    chip.addEventListener('click', function (e) {
      if (e.target === delBtn) return;
      switchToConversation(conv.id);
    });

    // Double-click label to rename inline
    label.addEventListener('dblclick', function (e) {
      e.stopPropagation();
      startInlineRename(chip, label, conv);
    });

    // Delete
    delBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      deleteConversation(conv.id);
    });

    return chip;
  }

  function startInlineRename(chip, label, conv) {
    var input = el('input', { className: 'claude-session-label-input' });
    input.value = conv.name || 'Session';
    chip.replaceChild(input, label);
    input.focus();
    input.select();

    var saved = false;

    function saveRename() {
      if (saved) return;
      saved = true;
      var newName = input.value.trim() || 'Session';
      if (!api || !api.renameConversation) {
        chip.replaceChild(label, input);
        return;
      }
      api.renameConversation(conv.id, newName).then(function () {
        if (conv.id === currentConvId) {
          currentConvName = newName;
        }
        refreshToolbar();
      }).catch(function () {
        chip.replaceChild(label, input);
      });
    }

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveRename();
      } else if (e.key === 'Escape') {
        saved = true; // prevent blur from saving
        chip.replaceChild(label, input);
      }
    });
    input.addEventListener('blur', saveRename);
  }

  // ── Conversation lifecycle ──────────────────────────────────────────────────

  function initConversations() {
    if (!api || !api.listConversations) return;
    api.listConversations().then(function (data) {
      var convs = (data && data.conversations) ? data.conversations : [];
      if (convs.length > 0) {
        // Load newest conversation
        var sorted = convs.slice().sort(function (a, b) {
          var ta = b.updated || b.created || '';
          var tb = a.updated || a.created || '';
          return ta > tb ? 1 : ta < tb ? -1 : 0;
        });
        loadConvIntoView(sorted[0].id);
      } else {
        createNewConversation();
      }
    }).catch(function () {
      createNewConversation();
    });
  }

  function loadConvIntoView(id) {
    if (!api || !api.loadConversation) return;
    api.loadConversation(id).then(function (data) {
      var conv = data && data.conversation ? data.conversation : data;
      if (!conv) return;

      currentConvId = conv.id;
      currentConvName = conv.name || 'Session';
      currentConvCreated = conv.created || new Date().toISOString();
      currentMessages = conv.messages || [];
      pendingAssistantText = '';

      // Clear and re-render history
      conversation.innerHTML = '';
      currentMessages.forEach(function (msg) {
        if (msg.role === 'user') {
          var userBubble = el('div', { className: 'claude-message claude-user' });
          var userText = el('div', { className: 'claude-message-text' });
          userText.textContent = msg.content;
          userBubble.appendChild(userText);
          conversation.appendChild(userBubble);
        } else if (msg.role === 'assistant') {
          var aMsg = el('div', { className: 'claude-message claude-assistant' });
          var aText = el('div', { className: 'claude-message-text' });
          aText.innerHTML = renderMarkdown(msg.content);
          aMsg.appendChild(aText);
          conversation.appendChild(aMsg);
        }
      });

      conversation.scrollTop = conversation.scrollHeight;
      refreshToolbar();
    }).catch(function () {
      refreshToolbar();
    });
  }

  function switchToConversation(id) {
    if (id === currentConvId) return;
    loadConvIntoView(id);
  }

  function createNewConversation() {
    if (!api || !api.createConversation) return;
    var name = 'Session ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    api.createConversation(name).then(function (data) {
      var conv = data && data.conversation ? data.conversation : data;
      if (!conv) return;
      currentConvId = conv.id;
      currentConvName = conv.name || name;
      currentConvCreated = conv.created || new Date().toISOString();
      currentMessages = [];
      pendingAssistantText = '';

      conversation.innerHTML = '';
      var newWelcome = el('div', { className: 'claude-system-msg' });
      newWelcome.textContent = 'New conversation started. Type a message below.';
      conversation.appendChild(newWelcome);

      refreshToolbar();
    }).catch(function (err) {
      appendSystemMessage('Could not create conversation: ' + (err && err.message ? err.message : String(err)), true);
    });
  }

  function deleteConversation(id) {
    if (!api || !api.deleteConversation) return;
    api.deleteConversation(id).then(function () {
      if (id !== currentConvId) {
        refreshToolbar();
        return;
      }
      // Was active — switch to newest remaining or create new
      if (!api.listConversations) {
        currentConvId = null;
        currentMessages = [];
        conversation.innerHTML = '';
        createNewConversation();
        return;
      }
      api.listConversations().then(function (data) {
        var convs = (data && data.conversations) ? data.conversations : [];
        var remaining = convs.filter(function (c) { return c.id !== id; });
        if (remaining.length > 0) {
          var sorted = remaining.sort(function (a, b) {
            var ta = b.updated || b.created || '';
            var tb = a.updated || a.created || '';
            return ta > tb ? 1 : ta < tb ? -1 : 0;
          });
          loadConvIntoView(sorted[0].id);
        } else {
          currentConvId = null;
          currentMessages = [];
          conversation.innerHTML = '';
          createNewConversation();
        }
      });
    }).catch(function () {
      refreshToolbar();
    });
  }

  // ── New button handler ──────────────────────────────────────────────────────
  newBtn.addEventListener('click', createNewConversation);

  // ── Textarea auto-resize + keyboard shortcut ────────────────────────────────
  promptInput.addEventListener('input', function () {
    promptInput.style.height = 'auto';
    var scrollH = promptInput.scrollHeight;
    promptInput.style.height = Math.min(scrollH, 150) + 'px';
  });

  promptInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  sendBtn.addEventListener('click', sendMessage);

  // ── Send message ────────────────────────────────────────────────────────────
  function sendMessage() {
    var text = promptInput.value.trim();
    if (!text || isProcessing || !api) return;

    // Render user bubble
    var userMsg = el('div', { className: 'claude-message claude-user' });
    var userText = el('div', { className: 'claude-message-text' });
    userText.textContent = text;
    userMsg.appendChild(userText);
    conversation.appendChild(userMsg);

    // Track user message in currentMessages
    currentMessages.push({ role: 'user', content: text, timestamp: new Date().toISOString() });

    // Reset pending assistant text
    pendingAssistantText = '';

    promptInput.value = '';
    promptInput.style.height = 'auto';
    isProcessing = true;
    statusBadge.textContent = 'Thinking...';
    statusBadge.classList.add('active');
    sendBtn.disabled = true;

    activeWorkerTaskId = '_claude_' + Date.now();
    toolCallMap = {};
    currentTextEl = null;

    // Build multi-turn prompt with prior context
    var priorMessages = currentMessages.slice(0, currentMessages.length - 1);
    var fullPrompt = text;
    if (priorMessages.length > 0) {
      var transcript = priorMessages.map(function (m) {
        return (m.role === 'user' ? 'User' : 'Assistant') + ': ' + m.content;
      }).join('\n');
      fullPrompt = '[Prior conversation context:\n' + transcript + ']\n\n[Current message:]\n' + text;
    }

    api.getSettings().then(function (settings) {
      var model = modelSelect.value || settings.defaultModel || 'sonnet';
      return api.spawnWorker({
        taskId: activeWorkerTaskId,
        prompt: fullPrompt,
        model: model,
        cliPath: settings.claudeCliPath || null,
        dangerouslySkipPermissions: settings.dangerouslySkipPermissions || false,
        projectDir: settings.activeProjectPath || null,
      });
    }).catch(function (err) {
      appendSystemMessage('Error: ' + (err && err.message ? err.message : String(err)), true);
      finishProcessing();
    });
  }

  // ── Text rendering helpers ──────────────────────────────────────────────────
  function flushText() { currentTextEl = null; }

  function appendTextContent(text) {
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
    // Accumulate into pendingAssistantText for later save
    pendingAssistantText += text;
  }

  function appendSystemMessage(text, isError) {
    flushText();
    var msg = el('div', { className: 'claude-system-msg' + (isError ? ' claude-error' : '') });
    msg.textContent = text;
    conversation.appendChild(msg);
  }

  function renderToolCall(block) {
    flushText();
    var wrapper2 = el('div', { className: 'claude-tool-call' });
    var hdr = el('div', { className: 'claude-tool-header' });
    var icon = el('span', { className: 'claude-tool-icon', text: '\u2699' });
    var name = el('span', { className: 'claude-tool-name', text: block.name });
    var toggle = el('span', { className: 'claude-tool-toggle', text: '\u25B6' });
    hdr.appendChild(icon); hdr.appendChild(name); hdr.appendChild(toggle);
    wrapper2.appendChild(hdr);
    var bodyEl = el('div', { className: 'claude-tool-body', style: { display: 'none' } });
    if (block.input) {
      var inputLabel = el('div', { className: 'claude-tool-label', text: 'Input:' });
      bodyEl.appendChild(inputLabel);
      var inputPre = el('pre', { className: 'claude-tool-input' });
      try {
        inputPre.textContent = typeof block.input === 'string' ? block.input : JSON.stringify(block.input, null, 2);
      } catch (e) { inputPre.textContent = String(block.input); }
      bodyEl.appendChild(inputPre);
    }
    wrapper2.appendChild(bodyEl);
    hdr.addEventListener('click', function () {
      var isOpen = bodyEl.style.display !== 'none';
      bodyEl.style.display = isOpen ? 'none' : 'block';
      toggle.textContent = isOpen ? '\u25B6' : '\u25BC';
      wrapper2.classList.toggle('expanded', !isOpen);
    });
    wrapper2._toolId = block.id || null;
    wrapper2._body = bodyEl;
    conversation.appendChild(wrapper2);
    if (block.id) toolCallMap[block.id] = wrapper2;
  }

  function appendToolResult(toolUseId, content) {
    flushText();
    var target = toolUseId ? toolCallMap[toolUseId] : null;
    var bodyEl = target ? target._body : null;
    var resultLabel = el('div', { className: 'claude-tool-label claude-tool-result-label', text: 'Result:' });
    var resultPre = el('pre', { className: 'claude-tool-result' });
    if (typeof content === 'string') {
      resultPre.textContent = content;
    } else if (Array.isArray(content)) {
      resultPre.textContent = content.map(function (b) { return b.type === 'text' ? b.text : JSON.stringify(b, null, 2); }).join('\n');
    } else {
      try { resultPre.textContent = JSON.stringify(content, null, 2); } catch (e) { resultPre.textContent = String(content); }
    }
    if (bodyEl) {
      bodyEl.appendChild(resultLabel); bodyEl.appendChild(resultPre);
    } else {
      var standalone = el('div', { className: 'claude-tool-result-standalone' });
      standalone.appendChild(resultLabel); standalone.appendChild(resultPre);
      conversation.appendChild(standalone);
    }
  }

  // ── Finish processing + auto-save ───────────────────────────────────────────
  function finishProcessing() {
    // Save accumulated assistant text to message history
    if (pendingAssistantText) {
      currentMessages.push({ role: 'assistant', content: pendingAssistantText, timestamp: new Date().toISOString() });
    }
    pendingAssistantText = '';

    // Auto-save conversation
    if (api && currentConvId && api.saveConversation) {
      api.saveConversation({
        id: currentConvId,
        name: currentConvName,
        messages: currentMessages,
        created: currentConvCreated || new Date().toISOString(),
        updated: new Date().toISOString(),
      }).catch(function () { /* silent */ });
    }

    isProcessing = false;
    statusBadge.textContent = 'Ready';
    statusBadge.classList.remove('active');
    sendBtn.disabled = false;
    activeWorkerTaskId = null;
    flushText();
    promptInput.focus();
  }

  // ── Event listeners for worker output ──────────────────────────────────────
  if (api) {
    workerListener = api.on('worker-output', function (data) {
      if (!activeWorkerTaskId || data.taskId !== activeWorkerTaskId) return;
      var lines = data.chunk.split('\n');
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) continue;
        try {
          var parsed = JSON.parse(line);
          if (parsed.type === 'assistant' && parsed.content) {
            for (var c = 0; c < parsed.content.length; c++) {
              var block = parsed.content[c];
              if (block.type === 'text') appendTextContent(block.text);
              else if (block.type === 'tool_use') renderToolCall(block);
            }
          } else if (parsed.type === 'content_block_start') {
            if (parsed.content_block && parsed.content_block.type === 'tool_use') renderToolCall(parsed.content_block);
          } else if (parsed.type === 'tool_result') {
            appendToolResult(parsed.tool_use_id, parsed.content);
          } else if (parsed.type === 'result') {
            flushText();
            if (parsed.result) {
              var resultMsg = el('div', { className: 'claude-message claude-assistant' });
              var resultText = el('div', { className: 'claude-message-text' });
              resultText.innerHTML = renderMarkdown(parsed.result);
              resultMsg.appendChild(resultText);
              conversation.appendChild(resultMsg);
              // Capture result text for message history
              pendingAssistantText += parsed.result;
            }
          } else if (parsed.type === 'system') {
            appendSystemMessage(parsed.message || JSON.stringify(parsed));
          }
        } catch (e) {
          appendTextContent(line + '\n');
        }
      }
      conversation.scrollTop = conversation.scrollHeight;
    });

    completeListener = api.on('worker-complete', function (data) {
      if (!activeWorkerTaskId || data.taskId !== activeWorkerTaskId) return;
      if (data.errorOutput) appendSystemMessage('[stderr] ' + data.errorOutput, true);
      finishProcessing();
    });

    // Initialize: load newest conversation or create new
    initConversations();
  }

  // ── Public controller ───────────────────────────────────────────────────────
  return {
    clear: function () { conversation.innerHTML = ''; toolCallMap = {}; currentTextEl = null; },
    destroy: function () {
      if (api && workerListener) api.off('worker-output', workerListener);
      if (api && completeListener) api.off('worker-complete', completeListener);
      wrapper.remove();
    },
    getElement: function () { return wrapper; },
  };
}
