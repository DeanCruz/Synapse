// CommandsModal — Browse, view, edit, add, delete command .md files
// Sidebar list + content viewer layout with full markdown content.

import React, { useState, useEffect, useCallback } from 'react';
import Modal from './Modal.jsx';

const COMMAND_TEMPLATE = '# `!command_name`\n\n**Purpose:** Describe what this command does.\n\n**Syntax:** `!command_name [options] {prompt}`\n\n---\n\n## Details\n\nAdd detailed instructions here.\n';

function CommandList({ commands, activeCommand, onSelect, label }) {
  if (!commands || commands.length === 0) {
    return <div className="commands-empty">No commands found</div>;
  }
  return (
    <>
      {commands.map(cmd => (
        <div
          key={cmd.name}
          className={'commands-list-item' + (activeCommand && activeCommand.name === cmd.name ? ' active' : '')}
          onClick={() => onSelect(cmd.name)}
        >
          <span className="commands-item-name">!{cmd.name}</span>
          <div className="commands-item-purpose">{cmd.purpose || ''}</div>
        </div>
      ))}
    </>
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

  const [synapseCommands, setSynapseCommands] = useState([]);
  const [projectCommands, setProjectCommands] = useState([]);
  const [activeCommand, setActiveCommand] = useState(null);
  const [activeCommandsDir, setActiveCommandsDir] = useState(null);
  const [viewerState, setViewerState] = useState('placeholder'); // 'placeholder' | 'view' | 'edit' | 'new'

  const loadCommands = useCallback(() => {
    if (!api) return;
    api.listCommands().then(cmds => setSynapseCommands(cmds || []));
    if (projectDir) {
      api.listProjectCommands(projectDir).then(cmds => setProjectCommands(cmds || []));
    }
  }, [api, projectDir]);

  useEffect(() => { loadCommands(); }, [loadCommands]);

  function selectCommand(name, commandsDir) {
    if (!api) return;
    const getter = commandsDir ? api.getCommand(name, commandsDir) : api.getCommand(name);
    getter.then(cmd => {
      if (!cmd) { setViewerState('placeholder'); setActiveCommand(null); return; }
      setActiveCommand(cmd);
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
      selectCommand(name, activeCommandsDir);
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
            <span className="commands-section-title">Synapse Commands</span>
            <button className="commands-add-btn" onClick={handleNewCommand}>+ New</button>
          </div>
          <div className="commands-list">
            <CommandList
              commands={synapseCommands}
              activeCommand={activeCommand}
              onSelect={name => selectCommand(name, null)}
            />
          </div>
          {projectDir && (
            <>
              <div className="commands-sidebar-header">
                <span className="commands-section-title">Project Commands</span>
              </div>
              <div className="commands-list">
                <CommandList
                  commands={projectCommands}
                  activeCommand={activeCommand}
                  onSelect={name => selectCommand(name, projectDir + '/_commands')}
                />
              </div>
            </>
          )}
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
