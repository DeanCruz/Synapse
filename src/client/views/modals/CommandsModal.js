// CommandsModal — Browse, view, and manage _commands/ markdown files
// ES module. Shows command list with documentation and add/edit/delete.

import { el } from '../../utils/dom.js';
import { createModalPopup } from './ModalFactory.js';

/**
 * Show the commands browser modal.
 *
 * @param {object} [opts]
 * @param {string} [opts.projectDir] — project directory for project-specific commands
 */
export function showCommandsModal(opts) {
  opts = opts || {};
  var popup = createModalPopup('commands-modal-overlay', 'Commands');
  var body = popup.body;
  var api = window.electronAPI;
  if (!api) return;

  // Layout: sidebar list + content viewer
  var layout = el('div', { className: 'commands-layout' });

  var sidebar = el('div', { className: 'commands-sidebar' });
  var sidebarHeader = el('div', { className: 'commands-sidebar-header' });
  var sidebarTitle = el('span', { text: 'Synapse Commands', className: 'commands-section-title' });
  sidebarHeader.appendChild(sidebarTitle);

  var addBtn = el('button', { className: 'commands-add-btn', text: '+ New' });
  sidebarHeader.appendChild(addBtn);
  sidebar.appendChild(sidebarHeader);

  var commandList = el('div', { className: 'commands-list' });
  sidebar.appendChild(commandList);

  // Project commands section (if project loaded)
  var projectList = null;
  if (opts.projectDir) {
    var projHeader = el('div', { className: 'commands-sidebar-header' });
    var projTitle = el('span', { text: 'Project Commands', className: 'commands-section-title' });
    projHeader.appendChild(projTitle);
    sidebar.appendChild(projHeader);
    projectList = el('div', { className: 'commands-list' });
    sidebar.appendChild(projectList);
  }

  var viewer = el('div', { className: 'commands-viewer' });
  var viewerPlaceholder = el('div', { className: 'commands-viewer-placeholder', text: 'Select a command to view documentation' });
  viewer.appendChild(viewerPlaceholder);

  layout.appendChild(sidebar);
  layout.appendChild(viewer);
  body.appendChild(layout);

  // State
  var activeCommand = null;
  var isEditing = false;

  function renderCommandList(commands, container, commandsDir) {
    container.innerHTML = '';
    if (!commands || commands.length === 0) {
      var empty = el('div', { className: 'commands-empty', text: 'No commands found' });
      container.appendChild(empty);
      return;
    }
    commands.forEach(function (cmd) {
      var item = el('div', { className: 'commands-list-item' });
      var nameEl = el('span', { className: 'commands-item-name', text: '!' + cmd.name });
      var purposeEl = el('div', { className: 'commands-item-purpose', text: cmd.purpose || '' });
      item.appendChild(nameEl);
      item.appendChild(purposeEl);
      item.addEventListener('click', function () {
        // Highlight active
        var allItems = container.querySelectorAll('.commands-list-item');
        allItems.forEach(function (i) { i.classList.remove('active'); });
        item.classList.add('active');
        showCommand(cmd.name, commandsDir);
      });
      container.appendChild(item);
    });
  }

  function showCommand(name, commandsDir) {
    var getter = commandsDir
      ? api.getCommand(name, commandsDir)
      : api.getCommand(name);

    getter.then(function (cmd) {
      if (!cmd) {
        viewer.innerHTML = '';
        viewer.appendChild(el('div', { className: 'commands-viewer-placeholder', text: 'Command not found' }));
        return;
      }
      activeCommand = cmd;
      isEditing = false;
      renderViewer(cmd, commandsDir);
    });
  }

  function renderViewer(cmd, commandsDir) {
    viewer.innerHTML = '';

    // Header with title and actions
    var header = el('div', { className: 'commands-viewer-header' });
    var title = el('h2', { className: 'commands-viewer-title', text: cmd.title || cmd.name });
    header.appendChild(title);

    var actions = el('div', { className: 'commands-viewer-actions' });
    var editBtn = el('button', { className: 'commands-action-btn', text: 'Edit' });
    editBtn.addEventListener('click', function () {
      renderEditor(cmd, commandsDir);
    });
    actions.appendChild(editBtn);

    var deleteBtn = el('button', { className: 'commands-action-btn commands-delete-btn', text: 'Delete' });
    deleteBtn.addEventListener('click', function () {
      if (confirm('Delete command "!' + cmd.name + '"?')) {
        var deleter = commandsDir
          ? api.deleteCommand(cmd.name, commandsDir)
          : api.deleteCommand(cmd.name);
        deleter.then(function () {
          loadCommands();
          viewer.innerHTML = '';
          viewer.appendChild(el('div', { className: 'commands-viewer-placeholder', text: 'Command deleted' }));
        });
      }
    });
    actions.appendChild(deleteBtn);

    header.appendChild(actions);
    viewer.appendChild(header);

    // Metadata
    if (cmd.purpose) {
      var purposeDiv = el('div', { className: 'commands-viewer-purpose' });
      var purposeLabel = el('span', { className: 'commands-meta-label', text: 'Purpose: ' });
      var purposeText = el('span', { text: cmd.purpose });
      purposeDiv.appendChild(purposeLabel);
      purposeDiv.appendChild(purposeText);
      viewer.appendChild(purposeDiv);
    }
    if (cmd.syntax) {
      var syntaxDiv = el('div', { className: 'commands-viewer-syntax' });
      var syntaxLabel = el('span', { className: 'commands-meta-label', text: 'Syntax: ' });
      var syntaxCode = el('code', { text: cmd.syntax });
      syntaxDiv.appendChild(syntaxLabel);
      syntaxDiv.appendChild(syntaxCode);
      viewer.appendChild(syntaxDiv);
    }

    // Full content rendered as preformatted markdown
    var contentPre = el('pre', { className: 'commands-viewer-content' });
    contentPre.textContent = cmd.content || '';
    viewer.appendChild(contentPre);
  }

  function renderEditor(cmd, commandsDir) {
    viewer.innerHTML = '';
    isEditing = true;

    var header = el('div', { className: 'commands-viewer-header' });
    var title = el('h2', { className: 'commands-viewer-title', text: 'Editing: ' + (cmd ? cmd.name : 'New Command') });
    header.appendChild(title);
    viewer.appendChild(header);

    // Name input (only for new commands)
    var nameInput = null;
    if (!cmd) {
      var nameGroup = el('div', { className: 'commands-editor-field' });
      var nameLabel = el('label', { text: 'Command Name:' });
      nameInput = el('input', { className: 'commands-editor-input', attrs: { type: 'text', placeholder: 'my_command' } });
      nameGroup.appendChild(nameLabel);
      nameGroup.appendChild(nameInput);
      viewer.appendChild(nameGroup);
    }

    // Content textarea
    var contentGroup = el('div', { className: 'commands-editor-field' });
    var contentLabel = el('label', { text: 'Markdown Content:' });
    var textarea = el('textarea', { className: 'commands-editor-textarea' });
    textarea.value = cmd ? (cmd.content || '') : getCommandTemplate();
    contentGroup.appendChild(contentLabel);
    contentGroup.appendChild(textarea);
    viewer.appendChild(contentGroup);

    // Save / Cancel buttons
    var btnGroup = el('div', { className: 'commands-editor-buttons' });
    var saveBtn = el('button', { className: 'commands-save-btn', text: 'Save' });
    saveBtn.addEventListener('click', function () {
      var name = cmd ? cmd.name : (nameInput ? nameInput.value.trim() : '');
      if (!name) { alert('Command name is required'); return; }
      var content = textarea.value;
      var saver = commandsDir
        ? api.saveCommand(name, content, commandsDir)
        : api.saveCommand(name, content);
      saver.then(function () {
        loadCommands();
        showCommand(name, commandsDir);
      });
    });
    var cancelBtn = el('button', { className: 'commands-action-btn', text: 'Cancel' });
    cancelBtn.addEventListener('click', function () {
      if (cmd) {
        renderViewer(cmd, commandsDir);
      } else {
        viewer.innerHTML = '';
        viewer.appendChild(el('div', { className: 'commands-viewer-placeholder', text: 'Select a command to view documentation' }));
      }
    });
    btnGroup.appendChild(saveBtn);
    btnGroup.appendChild(cancelBtn);
    viewer.appendChild(btnGroup);
  }

  function getCommandTemplate() {
    return '# `!command_name`\n\n**Purpose:** Describe what this command does.\n\n**Syntax:** `!command_name [options] {prompt}`\n\n---\n\n## Details\n\nAdd detailed instructions here.\n';
  }

  // Add new command button
  addBtn.addEventListener('click', function () {
    renderEditor(null, null);
  });

  // Load commands
  function loadCommands() {
    api.listCommands().then(function (commands) {
      renderCommandList(commands, commandList, null);
    });
    if (opts.projectDir && projectList) {
      api.listProjectCommands(opts.projectDir).then(function (commands) {
        renderCommandList(commands, projectList, opts.projectDir + '/_commands');
      });
    }
  }

  loadCommands();
  document.body.appendChild(popup.overlay);
}
