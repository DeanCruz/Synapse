// CommandsModal — Browse, view, edit, add, delete command .md files
// Sidebar list grouped by folder (collapsible) + content viewer layout.

import React, { useState, useEffect, useCallback } from 'react';
import Modal from './Modal.jsx';

const COMMAND_TEMPLATE = '# `!command_name`\n\n**Purpose:** Describe what this command does.\n\n**Syntax:** `!command_name [options] {prompt}`\n\n---\n\n## Details\n\nAdd detailed instructions here.\n';

function CommandFolder({ folder, commands, activeCommand, onSelect, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen || false);
  return (
    <div className="commands-folder">
      <button
        className={'commands-folder-header' + (open ? ' open' : '')}
        onClick={() => setOpen(o => !o)}
      >
        <svg className="commands-folder-chevron" width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M3 2l4 3-4 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span className="commands-folder-name">{folder}</span>
        <span className="commands-folder-count">{commands.length}</span>
      </button>
      {open && (
        <div className="commands-folder-items">
          {commands.map(cmd => (
            <div
              key={cmd.name + (cmd.subfolder || '')}
              className={'commands-list-item' + (activeCommand && activeCommand.name === cmd.name ? ' active' : '')}
              onClick={() => onSelect(cmd)}
            >
              <span className="commands-item-name">
                {cmd.subfolder ? <span className="commands-item-subfolder">{cmd.subfolder}/</span> : null}
                !{cmd.name}
              </span>
              <div className="commands-item-purpose">{cmd.purpose || ''}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CommandViewer({ cmd, commandsDir, onEdit, onDelete }) {
  return (
    <>
      <div className="commands-viewer-header">
        <h2 className="commands-viewer-title">{cmd.title || cmd.name}</h2>
        <div className="commands-viewer-actions">
          <button className="commands-action-btn" onClick={onEdit}>Edit</button>
          <button className="commands-action-btn commands-delete-btn" onClick={onDelete}>Delete</button>
        </div>
      </div>
      {cmd.purpose && (
        <div className="commands-viewer-purpose">
          <span className="commands-meta-label">Purpose: </span>
          <span>{cmd.purpose}</span>
        </div>
      )}
      {cmd.syntax && (
        <div className="commands-viewer-syntax">
          <span className="commands-meta-label">Syntax: </span>
          <code>{cmd.syntax}</code>
        </div>
      )}
      <pre className="commands-viewer-content">{cmd.content || ''}</pre>
    </>
  );
}

function CommandEditor({ cmd, commandsDir, onSave, onCancel }) {
  const [name, setName] = useState(cmd ? cmd.name : '');
  const [content, setContent] = useState(cmd ? (cmd.content || '') : COMMAND_TEMPLATE);

  function handleSave() {
    const finalName = cmd ? cmd.name : name.trim();
    if (!finalName) { alert('Command name is required'); return; }
    onSave(finalName, content);
  }

  return (
    <>
      <div className="commands-viewer-header">
        <h2 className="commands-viewer-title">
          {cmd ? 'Editing: ' + cmd.name : 'New Command'}
        </h2>
      </div>
      {!cmd && (
        <div className="commands-editor-field">
          <label>Command Name:</label>
          <input
            className="commands-editor-input"
            type="text"
            placeholder="my_command"
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>
      )}
      <div className="commands-editor-field">
        <label>Markdown Content:</label>
        <textarea
          className="commands-editor-textarea"
          value={content}
          onChange={e => setContent(e.target.value)}
        />
      </div>
      <div className="commands-editor-buttons">
        <button className="commands-save-btn" onClick={handleSave}>Save</button>
        <button className="commands-action-btn" onClick={onCancel}>Cancel</button>
      </div>
    </>
  );
}

export default function CommandsModal({ onClose, projectDir }) {
  const api = window.electronAPI || null;

  // Groups: [{ folder, commands[] }]
  const [synapseGroups, setSynapseGroups] = useState([]);
  const [projectGroups, setProjectGroups] = useState([]);
  const [activeCommand, setActiveCommand] = useState(null);
  const [activeCommandsDir, setActiveCommandsDir] = useState(null);
  const [viewerState, setViewerState] = useState('placeholder'); // 'placeholder' | 'view' | 'edit' | 'new'

  const loadCommands = useCallback(() => {
    if (!api) return;
    api.listCommands().then(groups => setSynapseGroups(groups || []));
    if (projectDir) {
      api.listProjectCommands(projectDir).then(groups => setProjectGroups(groups || []));
    }
  }, [api, projectDir]);

  useEffect(() => { loadCommands(); }, [loadCommands]);

  function selectCommand(cmd, commandsDir) {
    if (!api) return;
    const getter = commandsDir ? api.getCommand(cmd.name, commandsDir) : api.getCommand(cmd.name);
    getter.then(full => {
      if (!full) { setViewerState('placeholder'); setActiveCommand(null); return; }
      setActiveCommand(full);
      setActiveCommandsDir(commandsDir);
      setViewerState('view');
    });
  }

  function handleDelete() {
    if (!activeCommand || !api) return;
    if (!confirm('Delete command "!' + activeCommand.name + '"?')) return;
    const deleter = activeCommandsDir
      ? api.deleteCommand(activeCommand.name, activeCommandsDir)
      : api.deleteCommand(activeCommand.name);
    deleter.then(() => {
      loadCommands();
      setActiveCommand(null);
      setViewerState('placeholder');
    });
  }

  function handleSave(name, content) {
    if (!api) return;
    const saver = activeCommandsDir
      ? api.saveCommand(name, content, activeCommandsDir)
      : api.saveCommand(name, content);
    saver.then(() => {
      loadCommands();
      selectCommand({ name }, activeCommandsDir);
    });
  }

  function handleNewCommand() {
    setActiveCommand(null);
    setActiveCommandsDir(null);
    setViewerState('new');
  }

  return (
    <Modal title="Commands" onClose={onClose} className="commands-modal">
      <div className="commands-layout">
        <div className="commands-sidebar">
          <div className="commands-sidebar-header">
            <span className="commands-section-title">Commands</span>
            <button className="commands-add-btn" onClick={handleNewCommand}>+ New</button>
          </div>
          <div className="commands-list">
            {synapseGroups.map(group => (
              <CommandFolder
                key={group.folder}
                folder={group.folder}
                commands={group.commands}
                activeCommand={activeCommand}
                onSelect={cmd => selectCommand(cmd, null)}
              />
            ))}
            {projectGroups.map(group => (
              <CommandFolder
                key={'project-' + group.folder}
                folder={group.folder}
                commands={group.commands}
                activeCommand={activeCommand}
                onSelect={cmd => selectCommand(cmd, projectDir + '/_commands')}
              />
            ))}
            {synapseGroups.length === 0 && projectGroups.length === 0 && (
              <div className="commands-empty">No commands found</div>
            )}
          </div>
        </div>

        <div className="commands-viewer">
          {viewerState === 'placeholder' && (
            <div className="commands-viewer-placeholder">
              Select a command to view documentation
            </div>
          )}
          {viewerState === 'view' && activeCommand && (
            <CommandViewer
              cmd={activeCommand}
              commandsDir={activeCommandsDir}
              onEdit={() => setViewerState('edit')}
              onDelete={handleDelete}
            />
          )}
          {viewerState === 'edit' && activeCommand && (
            <CommandEditor
              cmd={activeCommand}
              commandsDir={activeCommandsDir}
              onSave={handleSave}
              onCancel={() => setViewerState('view')}
            />
          )}
          {viewerState === 'new' && (
            <CommandEditor
              cmd={null}
              commandsDir={null}
              onSave={handleSave}
              onCancel={() => setViewerState('placeholder')}
            />
          )}
        </div>
      </div>
    </Modal>
  );
}
