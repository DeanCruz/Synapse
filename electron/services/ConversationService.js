// ConversationService.js — Manages saved Claude chat conversations
// CommonJS module. Stores conversations as JSON files in {ROOT}/conversations/

const fs = require('fs');
const path = require('path');
const { CONVERSATIONS_DIR } = require('../../src/server/utils/constants');

function ensureDir() {
  fs.mkdirSync(CONVERSATIONS_DIR, { recursive: true });
}

/**
 * Returns array of {id, name, created, updated, messageCount} sorted newest-first by updated.
 */
function listConversations() {
  try {
    ensureDir();
    const files = fs.readdirSync(CONVERSATIONS_DIR).filter(f => f.endsWith('.json'));
    const results = [];
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(CONVERSATIONS_DIR, file), 'utf8');
        const conv = JSON.parse(raw);
        results.push({
          id: conv.id,
          name: conv.name,
          created: conv.created,
          updated: conv.updated,
          messageCount: Array.isArray(conv.messages) ? conv.messages.length : 0,
        });
      } catch (e) {
        // Skip malformed files
      }
    }
    results.sort((a, b) => new Date(b.updated) - new Date(a.updated));
    return results;
  } catch (e) {
    return [];
  }
}

/**
 * Returns full conversation object {id, name, created, updated, messages:[]} or null.
 */
function loadConversation(id) {
  try {
    const filePath = path.join(CONVERSATIONS_DIR, `${id}.json`);
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

/**
 * Writes conversation data to disk. Returns saved data or null on error.
 */
function saveConversation(data) {
  try {
    ensureDir();
    const toSave = { ...data, updated: new Date().toISOString() };
    const filePath = path.join(CONVERSATIONS_DIR, `${toSave.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(toSave, null, 2), 'utf8');
    return toSave;
  } catch (e) {
    return null;
  }
}

/**
 * Creates a new named conversation, saves it to disk, and returns it.
 * If name is not provided, defaults to 'Session {count+1}'.
 */
function createConversation(name) {
  try {
    ensureDir();
    let count = 0;
    try {
      count = fs.readdirSync(CONVERSATIONS_DIR).filter(f => f.endsWith('.json')).length;
    } catch (e) {
      count = 0;
    }
    const now = new Date().toISOString();
    const conv = {
      id: 'conv_' + Date.now(),
      name: name || ('Session ' + (count + 1)),
      created: now,
      updated: now,
      messages: [],
    };
    const filePath = path.join(CONVERSATIONS_DIR, `${conv.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(conv, null, 2), 'utf8');
    return conv;
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * Deletes the conversation file for the given id.
 * Returns {success: true} or {error: message}.
 */
function deleteConversation(id) {
  try {
    const filePath = path.join(CONVERSATIONS_DIR, `${id}.json`);
    fs.unlinkSync(filePath);
    return { success: true };
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * Renames a conversation. Returns updated conversation or {error: message}.
 */
function renameConversation(id, name) {
  try {
    const conv = loadConversation(id);
    if (!conv) {
      return { error: `Conversation not found: ${id}` };
    }
    const updated = saveConversation({ ...conv, name });
    if (!updated) {
      return { error: 'Failed to save renamed conversation' };
    }
    return updated;
  } catch (e) {
    return { error: e.message };
  }
}

module.exports = {
  listConversations,
  loadConversation,
  saveConversation,
  createConversation,
  deleteConversation,
  renameConversation,
};
