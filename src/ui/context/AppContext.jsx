// AppContext — Central state management via React Context + useReducer
// Replaces the old AppState.js observable container.

import React, { createContext, useContext, useReducer, useCallback } from 'react';

const AppContext = createContext(null);
const DispatchContext = createContext(null);

const CLAUDE_MESSAGES_KEY_PREFIX = 'synapse-claude-messages-';
const CLAUDE_TABS_KEY_PREFIX = 'synapse-claude-tabs-';
const CLAUDE_WELCOME_MSG = { id: 'welcome', type: 'system', text: 'Agent chat is ready. Type a message below to start.' };
const DEFAULT_TAB = { id: 'default', name: 'Chat 1' };

const IDE_WORKSPACES_KEY = 'synapse-ide-workspaces';

function claudeMessagesKey(dashboardId, tabId) {
  const base = CLAUDE_MESSAGES_KEY_PREFIX + (dashboardId || '');
  if (tabId && tabId !== 'default') return base + '-' + tabId;
  return base;
}

function claudeTabsKey(dashboardId) {
  return CLAUDE_TABS_KEY_PREFIX + (dashboardId || '');
}

function loadSavedTabs(dashboardId) {
  try {
    const raw = localStorage.getItem(claudeTabsKey(dashboardId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) { /* corrupt or unavailable */ }
  return null;
}

function saveTabs(dashboardId, tabs) {
  try { localStorage.setItem(claudeTabsKey(dashboardId), JSON.stringify(tabs)); } catch (e) { /* */ }
}

function loadSavedMessages(dashboardId, tabId) {
  try {
    const key = claudeMessagesKey(dashboardId, tabId);
    const raw = localStorage.getItem(key);
    if (!raw) {
      // Migration: move old global key to dashboard1 default tab
      if ((!tabId || tabId === 'default') && (!dashboardId || dashboardId === 'dashboard1')) {
        const oldRaw = localStorage.getItem('synapse-claude-messages');
        if (oldRaw) {
          const parsed = JSON.parse(oldRaw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            localStorage.setItem(key, oldRaw);
            localStorage.removeItem('synapse-claude-messages');
            return parsed;
          }
        }
      }
      return null;
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch (e) { /* corrupt or unavailable */ }
  return null;
}

function loadSavedWorkspaces() {
  try {
    const raw = localStorage.getItem(IDE_WORKSPACES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) { /* corrupt or unavailable */ }
  return [];
}

function saveWorkspaces(workspaces) {
  try { localStorage.setItem(IDE_WORKSPACES_KEY, JSON.stringify(workspaces)); } catch (e) { /* */ }
}

const savedWorkspaces = loadSavedWorkspaces();

const initialState = {
  currentDashboardId: 'dashboard1',
  currentInit: null,
  currentProgress: {},
  currentLogs: null,
  currentStatus: null,
  dashboardList: [],
  dashboardStates: {},
  dashboardNames: {},
  chatPreviews: {},
  homeViewActive: false,
  archiveViewActive: false,
  queueViewActive: false,
  queueItems: [],
  unblockedTasks: [],
  priorDashboardId: null,
  activeLogFilter: 'all',
  activeStatFilter: null,
  seenPermissionCount: 0,
  activeView: 'dashboard', // 'dashboard' | 'home' | 'swarmBuilder' | 'claude'
  activeModal: null, // null | 'commands' | 'project' | 'settings' | 'planning' | 'taskEditor'
  modalDashboardId: null, // which dashboard a modal was opened for
  claudeDashboardId: null, // which dashboard the Claude view is associated with
  claudeViewMode: 'expanded', // 'minimized' | 'collapsed' | 'expanded' | 'maximized'
  claudeEverOpened: false,   // true once the Claude panel has been opened — keeps it mounted
  connected: false,
  // Persistent Claude chat state (per-dashboard)
  claudeMessages: loadSavedMessages('dashboard1') || [CLAUDE_WELCOME_MSG],
  claudeTabStash: {}, // { [dashboardId:tabId]: messages } — in-memory cache for tab/dashboard switching
  claudeProcessingStash: {}, // { [dashboardId]: { isProcessing, status, pendingAttachments } }
  claudeTabs: {}, // { [dashboardId]: [{ id, name }] } — tabs per dashboard
  claudeActiveTabId: 'default', // active tab ID for current dashboard
  claudeActiveTabMap: {}, // { [dashboardId]: tabId } — stashed active tab for non-current dashboards
  claudeIsProcessing: false,
  claudeStatus: 'Ready',
  claudeActiveTaskId: null,
  claudePendingAttachments: [],
  // Unread chat message counts per dashboard (for sidebar glow)
  unreadChatCounts: {},
  // Per-dashboard caches for sidebar state derivation
  allDashboardProgress: {},
  allDashboardLogs: {},
  // IDE state — workspaces, open files, file trees, sidebar view
  ideWorkspaces: savedWorkspaces, // [{ id, path, name }]
  ideActiveWorkspaceId: savedWorkspaces.length > 0 ? savedWorkspaces[0].id : null,
  ideOpenFiles: {}, // { [workspaceId]: [{ id, path, name, isDirty }] }
  ideActiveFileId: {}, // { [workspaceId]: string }
  ideFileTrees: {}, // { [workspaceId]: treeData }
  ideSidebarView: 'explorer', // which sidebar panel is shown in IDE
  ideChatOpen: false, // whether IDE inline chat is open
};

function appReducerCore(state, action) {
  switch (action.type) {
    case 'SET':
      return { ...state, [action.key]: action.value };
    case 'UPDATE':
      return { ...state, ...action.partial };
    case 'SET_INIT':
      return { ...state, currentInit: action.data };
    case 'SET_PROGRESS':
      return { ...state, currentProgress: action.data };
    case 'SET_LOGS':
      return { ...state, currentLogs: action.data };
    case 'SET_STATUS':
      return { ...state, currentStatus: action.data };
    case 'SET_DASHBOARD_STATE': {
      const newStates = { ...state.dashboardStates, [action.id]: action.status };
      return { ...state, dashboardStates: newStates };
    }
    case 'SET_DASHBOARD_PROGRESS': {
      const newProgress = { ...state.allDashboardProgress, [action.dashboardId]: action.progress };
      return { ...state, allDashboardProgress: newProgress };
    }
    case 'SET_DASHBOARD_LOGS': {
      const newLogs = { ...state.allDashboardLogs, [action.dashboardId]: action.logs };
      return { ...state, allDashboardLogs: newLogs };
    }
    case 'SWITCH_DASHBOARD': {
      const prevDid = state.currentDashboardId;
      const prevTabId = state.claudeActiveTabId;
      // Stash current tab's messages
      const prevStashKey = prevDid + ':' + prevTabId;
      const newTabStash = { ...state.claudeTabStash, [prevStashKey]: state.claudeMessages };
      // Stash current dashboard's active tab ID
      const newActiveTabMap = { ...state.claudeActiveTabMap, [prevDid]: prevTabId };
      // Stash processing state
      const procStash = { ...state.claudeProcessingStash, [prevDid]: {
        isProcessing: state.claudeIsProcessing,
        status: state.claudeStatus,
        pendingAttachments: state.claudePendingAttachments,
      }};
      // Restore target dashboard's tab state
      const targetTabId = newActiveTabMap[action.id] || 'default';
      const targetStashKey = action.id + ':' + targetTabId;
      const targetMessages = newTabStash[targetStashKey] || loadSavedMessages(action.id, targetTabId) || [CLAUDE_WELCOME_MSG];
      const targetProc = procStash[action.id] || {};
      const targetTabs = state.claudeTabs[action.id] || loadSavedTabs(action.id) || [{ ...DEFAULT_TAB }];
      // Clear unread count for target dashboard if switching while in claude view
      const switchUnread = state.activeView === 'claude'
        ? (({ [action.id]: _, ...rest }) => rest)(state.unreadChatCounts)
        : state.unreadChatCounts;
      return {
        ...state,
        currentDashboardId: action.id,
        currentInit: null,
        currentProgress: {},
        currentLogs: null,
        currentStatus: null,
        activeLogFilter: 'all',
        seenPermissionCount: 0,
        activeView: state.activeView === 'claude' ? 'claude' : state.activeView === 'ide' ? 'ide' : 'dashboard',
        archiveViewActive: false,
        queueViewActive: false,
        // Tab state
        claudeTabStash: newTabStash,
        claudeActiveTabMap: newActiveTabMap,
        claudeActiveTabId: targetTabId,
        claudeTabs: { ...state.claudeTabs, [action.id]: targetTabs },
        // Swap chat state
        claudeProcessingStash: procStash,
        claudeMessages: targetMessages,
        claudeIsProcessing: targetProc.isProcessing || false,
        claudeStatus: targetProc.status || 'Ready',
        claudePendingAttachments: targetProc.pendingAttachments || [],
        claudeDashboardId: action.id,
        unblockedTasks: [],
        unreadChatCounts: switchUnread,
      };
    }
    case 'SET_VIEW': {
      const targetClaudeDash = action.dashboardId || state.claudeDashboardId || state.currentDashboardId;
      // Clear unread count when opening claude view for a dashboard
      const clearedUnread = action.view === 'claude'
        ? (({ [targetClaudeDash]: _, ...rest }) => rest)(state.unreadChatCounts)
        : state.unreadChatCounts;
      return {
        ...state,
        activeView: action.view,
        claudeDashboardId: targetClaudeDash,
        claudeEverOpened: state.claudeEverOpened || action.view === 'claude',
        unreadChatCounts: clearedUnread,
      };
    }
    case 'OPEN_MODAL':
      return { ...state, activeModal: action.modal, modalDashboardId: action.dashboardId || state.currentDashboardId };
    case 'CLOSE_MODAL':
      return { ...state, activeModal: null };
    case 'CLAUDE_SET_MESSAGES':
      return { ...state, claudeMessages: action.messages };
    case 'CLAUDE_APPEND_MSG': {
      const newMessages = [...state.claudeMessages, { id: Date.now() + Math.random(), ...action.msg }];
      // Track unread if user isn't viewing this dashboard's chat
      const shouldTrackUnread = action.msg.type === 'assistant' && state.activeView !== 'claude';
      const updatedUnread = shouldTrackUnread
        ? { ...state.unreadChatCounts, [state.currentDashboardId]: (state.unreadChatCounts[state.currentDashboardId] || 0) + 1 }
        : state.unreadChatCounts;
      return { ...state, claudeMessages: newMessages, unreadChatCounts: updatedUnread };
    }
    case 'CLAUDE_UPDATE_MESSAGES':
      // Functional update: action.updater(prevMessages) => newMessages
      return { ...state, claudeMessages: action.updater(state.claudeMessages) };
    case 'CLAUDE_CLEAR_MESSAGES':
      try { localStorage.removeItem(claudeMessagesKey(state.currentDashboardId, state.claudeActiveTabId)); } catch (e) { /* unavailable */ }
      return { ...state, claudeMessages: [CLAUDE_WELCOME_MSG], claudePendingAttachments: [] };
    case 'CLAUDE_SET_VIEW_MODE':
      return { ...state, claudeViewMode: action.mode };
    case 'CLAUDE_SET_PROCESSING':
      return { ...state, claudeIsProcessing: action.value };
    case 'CLAUDE_SET_STATUS':
      return { ...state, claudeStatus: action.value };
    case 'CLAUDE_SET_TASK_ID':
      return { ...state, claudeActiveTaskId: action.value };
    case 'CLAUDE_ADD_ATTACHMENT':
      // action.attachment = { id, name, type, dataUrl }
      return { ...state, claudePendingAttachments: [...state.claudePendingAttachments, action.attachment] };
    case 'CLAUDE_REMOVE_ATTACHMENT':
      // action.id = attachment id to remove
      return { ...state, claudePendingAttachments: state.claudePendingAttachments.filter(a => a.id !== action.id) };
    case 'CLAUDE_CLEAR_ATTACHMENTS':
      return { ...state, claudePendingAttachments: [] };
    // --- Tab management ---
    case 'CLAUDE_NEW_TAB': {
      const did = state.currentDashboardId;
      const currentTabs = state.claudeTabs[did] || [{ ...DEFAULT_TAB }];
      const newTabId = 'tab-' + Date.now();
      const newTabName = 'Chat ' + (currentTabs.length + 1);
      const updatedTabs = [...currentTabs, { id: newTabId, name: newTabName }];
      const stashKey = did + ':' + state.claudeActiveTabId;
      const newTabStash = { ...state.claudeTabStash, [stashKey]: state.claudeMessages };
      try { localStorage.setItem(claudeMessagesKey(did, state.claudeActiveTabId), JSON.stringify(state.claudeMessages)); } catch (e) { /* */ }
      saveTabs(did, updatedTabs);
      return {
        ...state,
        claudeTabs: { ...state.claudeTabs, [did]: updatedTabs },
        claudeActiveTabId: newTabId,
        claudeTabStash: newTabStash,
        claudeMessages: [CLAUDE_WELCOME_MSG],
        claudePendingAttachments: [],
      };
    }
    case 'CLAUDE_SWITCH_TAB': {
      const did = state.currentDashboardId;
      const targetTabId = action.tabId;
      if (targetTabId === state.claudeActiveTabId) return state;
      const stashKey = did + ':' + state.claudeActiveTabId;
      const newTabStash = { ...state.claudeTabStash, [stashKey]: state.claudeMessages };
      try { localStorage.setItem(claudeMessagesKey(did, state.claudeActiveTabId), JSON.stringify(state.claudeMessages)); } catch (e) { /* */ }
      const targetStashKey = did + ':' + targetTabId;
      const targetMessages = newTabStash[targetStashKey] || loadSavedMessages(did, targetTabId) || [CLAUDE_WELCOME_MSG];
      return {
        ...state,
        claudeActiveTabId: targetTabId,
        claudeTabStash: newTabStash,
        claudeMessages: targetMessages,
      };
    }
    case 'CLAUDE_CLOSE_TAB': {
      const did = state.currentDashboardId;
      const currentTabs = state.claudeTabs[did] || [{ ...DEFAULT_TAB }];
      if (currentTabs.length <= 1) return state;
      const closingTabId = action.tabId;
      const updatedTabs = currentTabs.filter(t => t.id !== closingTabId);
      const stashKey = did + ':' + closingTabId;
      const newTabStash = { ...state.claudeTabStash };
      delete newTabStash[stashKey];
      try { localStorage.removeItem(claudeMessagesKey(did, closingTabId)); } catch (e) { /* */ }
      saveTabs(did, updatedTabs);
      if (closingTabId === state.claudeActiveTabId) {
        const closedIdx = currentTabs.findIndex(t => t.id === closingTabId);
        const newActive = updatedTabs[Math.min(closedIdx, updatedTabs.length - 1)];
        const targetStashKey = did + ':' + newActive.id;
        const targetMessages = newTabStash[targetStashKey] || loadSavedMessages(did, newActive.id) || [CLAUDE_WELCOME_MSG];
        return {
          ...state,
          claudeTabs: { ...state.claudeTabs, [did]: updatedTabs },
          claudeActiveTabId: newActive.id,
          claudeTabStash: newTabStash,
          claudeMessages: targetMessages,
        };
      }
      return {
        ...state,
        claudeTabs: { ...state.claudeTabs, [did]: updatedTabs },
        claudeTabStash: newTabStash,
      };
    }
    case 'CLAUDE_RENAME_TAB': {
      const did = state.currentDashboardId;
      const currentTabs = state.claudeTabs[did] || [{ ...DEFAULT_TAB }];
      const updatedTabs = currentTabs.map(t => t.id === action.tabId ? { ...t, name: action.name } : t);
      saveTabs(did, updatedTabs);
      return { ...state, claudeTabs: { ...state.claudeTabs, [did]: updatedTabs } };
    }
    // --- Stashed tab updates (for non-active tabs on same dashboard with running workers) ---
    case 'CLAUDE_TAB_STASH_APPEND_MSG': {
      const did = state.currentDashboardId;
      const stashKey = did + ':' + action.tabId;
      const stashedMsgs = state.claudeTabStash[stashKey] || loadSavedMessages(did, action.tabId) || [CLAUDE_WELCOME_MSG];
      const updatedMsgs = [...stashedMsgs, { id: Date.now() + Math.random(), ...action.msg }];
      const newTabStash = { ...state.claudeTabStash, [stashKey]: updatedMsgs };
      try { localStorage.setItem(claudeMessagesKey(did, action.tabId), JSON.stringify(updatedMsgs)); } catch (e) { /* */ }
      return { ...state, claudeTabStash: newTabStash };
    }
    // --- Stashed dashboard updates (for non-active dashboards with running workers) ---
    case 'CLAUDE_STASH_APPEND_MSG': {
      const did = action.dashboardId;
      const activeTab = state.claudeActiveTabMap[did] || 'default';
      const stashKey = did + ':' + activeTab;
      const stashedMsgs = state.claudeTabStash[stashKey] || loadSavedMessages(did, activeTab) || [CLAUDE_WELCOME_MSG];
      const updatedMsgs = [...stashedMsgs, { id: Date.now() + Math.random(), ...action.msg }];
      const newTabStash = { ...state.claudeTabStash, [stashKey]: updatedMsgs };
      try { localStorage.setItem(claudeMessagesKey(did, activeTab), JSON.stringify(updatedMsgs)); } catch (e) { /* */ }
      // Track unread assistant messages for non-active dashboards
      const unreadChatCounts = action.msg.type === 'assistant'
        ? { ...state.unreadChatCounts, [did]: (state.unreadChatCounts[did] || 0) + 1 }
        : state.unreadChatCounts;
      return { ...state, claudeTabStash: newTabStash, unreadChatCounts };
    }
    case 'CLAUDE_STASH_UPDATE_MESSAGES': {
      const did = action.dashboardId;
      const activeTab = state.claudeActiveTabMap[did] || 'default';
      const stashKey = did + ':' + activeTab;
      const stashedMsgs = state.claudeTabStash[stashKey] || loadSavedMessages(did, activeTab) || [CLAUDE_WELCOME_MSG];
      const updatedMsgs = action.updater(stashedMsgs);
      const newTabStash = { ...state.claudeTabStash, [stashKey]: updatedMsgs };
      try { localStorage.setItem(claudeMessagesKey(did, activeTab), JSON.stringify(updatedMsgs)); } catch (e) { /* */ }
      return { ...state, claudeTabStash: newTabStash };
    }
    case 'REMOVE_DASHBOARD': {
      // Clean up state when a dashboard is deleted
      const rid = action.id;
      const newDashStates = { ...state.dashboardStates };
      delete newDashStates[rid];
      const newAllProgress = { ...state.allDashboardProgress };
      delete newAllProgress[rid];
      const newAllLogs = { ...state.allDashboardLogs };
      delete newAllLogs[rid];
      // Clean up tab-related data
      const tabsForDash = state.claudeTabs[rid] || [];
      const newTabStash = { ...state.claudeTabStash };
      tabsForDash.forEach(tab => {
        delete newTabStash[rid + ':' + tab.id];
        try { localStorage.removeItem(claudeMessagesKey(rid, tab.id)); } catch (e) { /* */ }
      });
      try { localStorage.removeItem(CLAUDE_MESSAGES_KEY_PREFIX + rid); } catch (e) { /* */ }
      const newTabs = { ...state.claudeTabs };
      delete newTabs[rid];
      const newActiveTabMap = { ...state.claudeActiveTabMap };
      delete newActiveTabMap[rid];
      try { localStorage.removeItem(claudeTabsKey(rid)); } catch (e) { /* */ }
      const newProcStash2 = { ...state.claudeProcessingStash };
      delete newProcStash2[rid];
      const newDashNames = { ...state.dashboardNames };
      delete newDashNames[rid];
      const newUnread = { ...state.unreadChatCounts };
      delete newUnread[rid];
      return {
        ...state,
        dashboardStates: newDashStates,
        dashboardNames: newDashNames,
        allDashboardProgress: newAllProgress,
        allDashboardLogs: newAllLogs,
        claudeTabStash: newTabStash,
        claudeTabs: newTabs,
        claudeActiveTabMap: newActiveTabMap,
        claudeProcessingStash: newProcStash2,
        unreadChatCounts: newUnread,
      };
    }
    case 'CLAUDE_STASH_SET_PROCESSING': {
      const did = action.dashboardId;
      const existing = state.claudeProcessingStash[did] || {};
      const newProcStash = { ...state.claudeProcessingStash, [did]: { ...existing, isProcessing: action.value, status: action.status || existing.status || 'Ready' } };
      return { ...state, claudeProcessingStash: newProcStash };
    }
    case 'SET_CHAT_PREVIEW': {
      return {
        ...state,
        chatPreviews: {
          ...state.chatPreviews,
          [action.dashboardId]: { text: action.text, isStreaming: action.isStreaming || false },
        },
      };
    }
    case 'CLEAR_CHAT_PREVIEW': {
      const { [action.dashboardId]: _, ...rest } = state.chatPreviews;
      return { ...state, chatPreviews: rest };
    }
    case 'SET_DASHBOARDS_LIST': {
      const dashboardList = action.value;
      const dashboardNames = action.names
        ? { ...state.dashboardNames, ...action.names }
        : state.dashboardNames;
      // If current dashboard doesn't exist in the list, switch to first available
      if (dashboardList.length > 0 && !dashboardList.includes(state.currentDashboardId)) {
        return { ...state, dashboardList, dashboardNames, currentDashboardId: dashboardList[0] };
      }
      return { ...state, dashboardList, dashboardNames };
    }
    case 'SET_DASHBOARD_NAMES':
      return { ...state, dashboardNames: action.names || {} };
    case 'REORDER_DASHBOARDS':
      return { ...state, dashboardList: action.orderedIds };
    case 'RENAME_DASHBOARD': {
      const newNames = { ...state.dashboardNames };
      if (action.name) {
        newNames[action.id] = action.name;
      } else {
        delete newNames[action.id];
      }
      return { ...state, dashboardNames: newNames };
    }
    case 'SET_UNBLOCKED_TASKS':
      return { ...state, unblockedTasks: action.tasks || [] };
    case 'CLEAR_UNBLOCKED_TASKS':
      return { ...state, unblockedTasks: [] };
    // --- IDE state management ---
    case 'IDE_OPEN_WORKSPACE': {
      const wsId = action.id || String(Date.now());
      const newWorkspace = { id: wsId, path: action.path, name: action.name };
      // Check if this path is already open
      const existing = state.ideWorkspaces.find(w => w.path === action.path);
      if (existing) {
        // Just switch to the existing workspace
        return { ...state, ideActiveWorkspaceId: existing.id };
      }
      const updatedWorkspaces = [...state.ideWorkspaces, newWorkspace];
      saveWorkspaces(updatedWorkspaces);
      return {
        ...state,
        ideWorkspaces: updatedWorkspaces,
        ideActiveWorkspaceId: wsId,
      };
    }
    case 'IDE_CLOSE_WORKSPACE': {
      const closingWsId = action.workspaceId;
      const updatedWorkspaces = state.ideWorkspaces.filter(w => w.id !== closingWsId);
      // Clean up open files, active file, and file tree for this workspace
      const newOpenFiles = { ...state.ideOpenFiles };
      delete newOpenFiles[closingWsId];
      const newActiveFileId = { ...state.ideActiveFileId };
      delete newActiveFileId[closingWsId];
      const newFileTrees = { ...state.ideFileTrees };
      delete newFileTrees[closingWsId];
      // Switch to adjacent workspace if the closed one was active
      let newActiveWsId = state.ideActiveWorkspaceId;
      if (newActiveWsId === closingWsId) {
        if (updatedWorkspaces.length > 0) {
          const closedIdx = state.ideWorkspaces.findIndex(w => w.id === closingWsId);
          const newIdx = Math.min(closedIdx, updatedWorkspaces.length - 1);
          newActiveWsId = updatedWorkspaces[newIdx].id;
        } else {
          newActiveWsId = null;
        }
      }
      saveWorkspaces(updatedWorkspaces);
      return {
        ...state,
        ideWorkspaces: updatedWorkspaces,
        ideActiveWorkspaceId: newActiveWsId,
        ideOpenFiles: newOpenFiles,
        ideActiveFileId: newActiveFileId,
        ideFileTrees: newFileTrees,
        ideChatOpen: state.ideActiveWorkspaceId === closingWsId ? false : state.ideChatOpen,
      };
    }
    case 'IDE_SWITCH_WORKSPACE': {
      return { ...state, ideActiveWorkspaceId: action.workspaceId };
    }
    case 'IDE_SET_FILE_TREE': {
      const newFileTrees = { ...state.ideFileTrees, [action.workspaceId]: action.tree };
      return { ...state, ideFileTrees: newFileTrees };
    }
    case 'IDE_OPEN_FILE': {
      const wsId = action.workspaceId;
      const currentFiles = state.ideOpenFiles[wsId] || [];
      // Check if the file is already open (by path)
      const existingFile = currentFiles.find(f => f.path === action.file.path);
      if (existingFile) {
        // Just switch to the existing file
        const newActiveFileId = { ...state.ideActiveFileId, [wsId]: existingFile.id };
        return { ...state, ideActiveFileId: newActiveFileId };
      }
      const fileId = String(Date.now()) + '-' + Math.random().toString(36).slice(2, 7);
      const newFile = { id: fileId, path: action.file.path, name: action.file.name, isDirty: false };
      const updatedFiles = [...currentFiles, newFile];
      const newOpenFiles = { ...state.ideOpenFiles, [wsId]: updatedFiles };
      const newActiveFileId = { ...state.ideActiveFileId, [wsId]: fileId };
      return { ...state, ideOpenFiles: newOpenFiles, ideActiveFileId: newActiveFileId };
    }
    case 'IDE_CLOSE_FILE': {
      const wsId = action.workspaceId;
      const currentFiles = state.ideOpenFiles[wsId] || [];
      const updatedFiles = currentFiles.filter(f => f.id !== action.fileId);
      const newOpenFiles = { ...state.ideOpenFiles, [wsId]: updatedFiles };
      // Switch to adjacent file if the closed one was active
      let newActiveId = state.ideActiveFileId[wsId];
      if (newActiveId === action.fileId) {
        if (updatedFiles.length > 0) {
          const closedIdx = currentFiles.findIndex(f => f.id === action.fileId);
          const newIdx = Math.min(closedIdx, updatedFiles.length - 1);
          newActiveId = updatedFiles[newIdx].id;
        } else {
          newActiveId = null;
        }
      }
      const newActiveFileId = { ...state.ideActiveFileId, [wsId]: newActiveId };
      return { ...state, ideOpenFiles: newOpenFiles, ideActiveFileId: newActiveFileId };
    }
    case 'IDE_SWITCH_FILE': {
      const newActiveFileId = { ...state.ideActiveFileId, [action.workspaceId]: action.fileId };
      return { ...state, ideActiveFileId: newActiveFileId };
    }
    case 'IDE_MARK_FILE_DIRTY': {
      const wsId = action.workspaceId;
      const currentFiles = state.ideOpenFiles[wsId] || [];
      const updatedFiles = currentFiles.map(f =>
        f.id === action.fileId ? { ...f, isDirty: true } : f
      );
      const newOpenFiles = { ...state.ideOpenFiles, [wsId]: updatedFiles };
      return { ...state, ideOpenFiles: newOpenFiles };
    }
    case 'IDE_MARK_FILE_CLEAN': {
      const wsId = action.workspaceId;
      const currentFiles = state.ideOpenFiles[wsId] || [];
      const updatedFiles = currentFiles.map(f =>
        f.id === action.fileId ? { ...f, isDirty: false } : f
      );
      const newOpenFiles = { ...state.ideOpenFiles, [wsId]: updatedFiles };
      return { ...state, ideOpenFiles: newOpenFiles };
    }
    case 'IDE_OPEN_CHAT':
      return { ...state, ideChatOpen: true, claudeViewMode: 'expanded', claudeEverOpened: true };
    case 'IDE_CLOSE_CHAT':
      return { ...state, ideChatOpen: false };
    default:
      return state;
  }
}

const CLAUDE_PERSIST_ACTIONS = new Set(['CLAUDE_SET_MESSAGES', 'CLAUDE_APPEND_MSG', 'CLAUDE_UPDATE_MESSAGES']);

// Debounced localStorage persistence — avoids serializing on every streaming delta
let persistTimer = null;
function schedulePersist(dashboardId, tabId, messages) {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      localStorage.setItem(claudeMessagesKey(dashboardId, tabId), JSON.stringify(messages));
    } catch (e) { /* quota exceeded or private browsing */ }
  }, 500);
}

function appReducer(state, action) {
  const newState = appReducerCore(state, action);
  if (CLAUDE_PERSIST_ACTIONS.has(action.type)) {
    schedulePersist(newState.currentDashboardId, newState.claudeActiveTabId, newState.claudeMessages);
  }
  return newState;
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(appReducer, initialState);
  return (
    <AppContext.Provider value={state}>
      <DispatchContext.Provider value={dispatch}>
        {children}
      </DispatchContext.Provider>
    </AppContext.Provider>
  );
}

export function useAppState() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppState must be inside AppProvider');
  return ctx;
}

export function useDispatch() {
  const dispatch = useContext(DispatchContext);
  if (!dispatch) throw new Error('useDispatch must be inside AppProvider');
  return dispatch;
}
