// AppContext — Central state management via React Context + useReducer
// Replaces the old AppState.js observable container.

import React, { createContext, useContext, useReducer, useCallback } from 'react';

const AppContext = createContext(null);
const DispatchContext = createContext(null);

const CLAUDE_MESSAGES_KEY_PREFIX = 'synapse-claude-messages-';
const CLAUDE_TABS_KEY_PREFIX = 'synapse-claude-tabs-';
const CLAUDE_WELCOME_MSG = { id: 'welcome', type: 'system', text: 'Agent chat is ready. Type a message below to start.' };
const DEFAULT_TAB = { id: 'default', name: 'Chat 1' };
const MAX_CHAT_MESSAGES = 200; // Hard cap on in-memory message count per tab

const IDE_WORKSPACES_KEY = 'synapse-ide-workspaces';
const GIT_REPOS_KEY = 'synapse-git-repos';

// Helper: deep-update a tree node's children by path
function updateTreeNode(node, targetPath, children) {
  if (node.path === targetPath) {
    return { ...node, children };
  }
  if (!node.children) return node;
  return {
    ...node,
    children: node.children.map(child => updateTreeNode(child, targetPath, children)),
  };
}

// Trim a messages array to MAX_CHAT_MESSAGES, preserving the first system
// message (e.g. "Connected" / welcome) and inserting a trim notice.
function trimMessages(msgs) {
  if (msgs.length <= MAX_CHAT_MESSAGES) return msgs;
  const trimCount = msgs.length - MAX_CHAT_MESSAGES;
  const first = msgs[0]?.type === 'system' ? [msgs[0]] : [];
  const trimNotice = { id: 'trim-notice-' + Date.now(), type: 'system', text: `[${trimCount} older messages trimmed]` };
  // Keep: first system message (if any) + trim notice + last (MAX - first.length - 1) messages
  return first.concat(
    [trimNotice],
    msgs.slice(msgs.length - MAX_CHAT_MESSAGES + first.length + 1)
  );
}

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

function loadSavedGitRepos() {
  try {
    const raw = localStorage.getItem(GIT_REPOS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) { /* corrupt or unavailable */ }
  return [];
}

function saveGitRepos(repos) {
  try { localStorage.setItem(GIT_REPOS_KEY, JSON.stringify(repos)); } catch (e) { /* */ }
}

const savedWorkspaces = loadSavedWorkspaces();
const savedGitRepos = loadSavedGitRepos();

const initialState = {
  currentDashboardId: null,
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
  pendingPermission: null, // { pid, toolName, toolInput, requestId, toolUseId, timestamp } — active permission request from a worker
  activeView: 'dashboard', // 'dashboard' | 'home' | 'swarmBuilder' | 'claude' | 'ide' | 'git'
  activeModal: null, // null | 'commands' | 'project' | 'settings' | 'planning' | 'taskEditor'
  modalDashboardId: null, // which dashboard a modal was opened for
  claudeDashboardId: null, // which dashboard the Claude view is associated with
  claudeViewMode: 'expanded', // 'minimized' | 'collapsed' | 'expanded' | 'maximized'
  claudeEverOpened: false,   // true once the Claude panel has been opened — keeps it mounted
  connected: false,
  // Persistent Claude chat state (per-dashboard)
  claudeMessages: [CLAUDE_WELCOME_MSG],
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
  // Search state
  ideSearchQuery: '',
  ideSearchOptions: { regex: false, caseSensitive: false, wholeWord: false, includeGlob: '', excludeGlob: '' },
  ideSearchResults: null, // null = no search yet, [] = no results, [...] = results
  ideSearchLoading: false,
  ideSearchTotalMatches: 0,
  ideSearchTruncated: false,
  ideSearchReplaceMode: false,
  ideSearchReplaceText: '',
  // Debug state — breakpoints, session, call stack, variables, scopes, watch expressions
  debugBreakpoints: {}, // { [filePath]: [lineNumber, ...] }
  debugSession: { status: 'idle', pausedFile: null, pausedLine: null, threadId: null }, // debug session state
  debugCallStack: [], // [{ id, name, source, line, column }]
  debugVariables: {}, // { [scopeId]: [{ name, value, type, variablesReference }] }
  debugScopes: [], // [{ name, variablesReference, expensive }]
  debugWatchExpressions: [], // [{ id, expression, value, error }]
  // Diagnostics state — per-file syntax errors, warnings, info
  diagnostics: {}, // { [filePath]: [{ line, column, endLine, endColumn, message, severity, source }] }
  // Git Manager state — open repos, active repo, git data, loading states
  gitRepos: savedGitRepos, // [{ id, path, name }]
  gitActiveRepoId: savedGitRepos.length > 0 ? savedGitRepos[0].id : null,
  gitStatus: null, // { staged: [], unstaged: [], untracked: [] }
  gitBranches: [], // [{ name, current, tracking, ahead, behind }]
  gitCurrentBranch: null, // string — name of current branch
  gitLog: [], // [{ hash, abbrevHash, author, date, message, parents, refs }]
  gitDiff: null, // string — current diff content
  gitRemotes: [], // [{ name, fetchUrl, pushUrl }]
  gitLoading: false, // boolean — global loading indicator
  gitError: null, // string | null — last error message
  gitSelectedFile: null, // string | null — currently selected file path for diff view
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
      // If no current dashboard yet (initial state), skip stashing — just set the new ID
      if (!state.currentDashboardId) {
        return { ...state, currentDashboardId: action.id };
      }
      const prevDid = state.currentDashboardId;
      const prevTabId = state.claudeActiveTabId;
      // Stash current tab's messages
      const prevStashKey = prevDid + ':' + prevTabId;
      const newTabStash = { ...state.claudeTabStash, [prevStashKey]: state.claudeMessages };
      // Stash current dashboard's active tab ID
      const newActiveTabMap = { ...state.claudeActiveTabMap, [prevDid]: prevTabId };
      // Stash processing state + chat view state
      const procStash = { ...state.claudeProcessingStash, [prevDid]: {
        isProcessing: state.claudeIsProcessing,
        status: state.claudeStatus,
        pendingAttachments: state.claudePendingAttachments,
        viewMode: state.claudeViewMode,
        chatOpen: state.activeView === 'claude',
        ideChatOpen: state.ideChatOpen,
      }};
      // Restore target dashboard's tab state
      const targetTabId = newActiveTabMap[action.id] || 'default';
      const targetStashKey = action.id + ':' + targetTabId;
      const targetMessages = newTabStash[targetStashKey] || loadSavedMessages(action.id, targetTabId) || [CLAUDE_WELCOME_MSG];
      const targetProc = procStash[action.id] || {};
      const targetTabs = state.claudeTabs[action.id] || loadSavedTabs(action.id) || [{ ...DEFAULT_TAB }];
      // Keep current view and chat mode — user's view context is global, not per-dashboard.
      // If the user is viewing chat, they stay in chat. If viewing dashboard, they stay there.
      const targetActiveView = state.activeView;
      const targetViewMode = state.claudeViewMode;
      const targetIdeChatOpen = state.ideChatOpen;
      // Clear unread count for target dashboard if chat will be visible
      const switchUnread = targetActiveView === 'claude'
        ? (({ [action.id]: _, ...rest }) => rest)(state.unreadChatCounts)
        : state.unreadChatCounts;
      // Use cached data from allDashboardProgress/allDashboardLogs instead of
      // resetting to empty — prevents tasks from flickering to "pending" during
      // the async re-fetch window.
      const cachedProgress = state.allDashboardProgress[action.id] || {};
      const cachedLogs = state.allDashboardLogs[action.id] || null;
      return {
        ...state,
        currentDashboardId: action.id,
        currentInit: null,
        currentProgress: cachedProgress,
        currentLogs: cachedLogs,
        currentStatus: null,
        activeLogFilter: 'all',
        seenPermissionCount: 0,
        activeView: targetActiveView,
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
        claudeViewMode: targetViewMode,
        ideChatOpen: targetIdeChatOpen,
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
      const newMessages = trimMessages([...state.claudeMessages, { id: Date.now() + Math.random(), ...action.msg }]);
      // Track unread if user isn't viewing this dashboard's chat
      const shouldTrackUnread = action.msg.type === 'assistant' && state.activeView !== 'claude';
      const updatedUnread = (shouldTrackUnread && state.currentDashboardId)
        ? { ...state.unreadChatCounts, [state.currentDashboardId]: (state.unreadChatCounts[state.currentDashboardId] || 0) + 1 }
        : state.unreadChatCounts;
      return { ...state, claudeMessages: newMessages, unreadChatCounts: updatedUnread };
    }
    case 'CLAUDE_UPDATE_MESSAGES':
      // Functional update: action.updater(prevMessages) => newMessages
      return { ...state, claudeMessages: trimMessages(action.updater(state.claudeMessages)) };
    case 'CLAUDE_CLEAR_MESSAGES':
      if (!state.currentDashboardId) return state;
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
    // --- Permission request management ---
    case 'PERMISSION_REQUEST':
      // action.permission = { pid, toolName, toolInput, requestId, toolUseId, timestamp }
      return { ...state, pendingPermission: action.permission };
    case 'PERMISSION_RESOLVED':
      // Clear the pending permission (optionally match by requestId)
      if (state.pendingPermission && action.requestId && state.pendingPermission.requestId !== action.requestId) {
        return state; // Don't clear if it's a different request
      }
      return { ...state, pendingPermission: null };
    // --- Tab management ---
    case 'CLAUDE_NEW_TAB': {
      if (!state.currentDashboardId) return state;
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
      if (!state.currentDashboardId) return state;
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
      if (!state.currentDashboardId) return state;
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
      if (!state.currentDashboardId) return state;
      const did = state.currentDashboardId;
      const currentTabs = state.claudeTabs[did] || [{ ...DEFAULT_TAB }];
      const updatedTabs = currentTabs.map(t => t.id === action.tabId ? { ...t, name: action.name } : t);
      saveTabs(did, updatedTabs);
      return { ...state, claudeTabs: { ...state.claudeTabs, [did]: updatedTabs } };
    }
    // --- Stashed tab updates (for non-active tabs on same dashboard with running workers) ---
    case 'CLAUDE_TAB_STASH_APPEND_MSG': {
      if (!state.currentDashboardId) return state;
      const did = state.currentDashboardId;
      const stashKey = did + ':' + action.tabId;
      const stashedMsgs = state.claudeTabStash[stashKey] || loadSavedMessages(did, action.tabId) || [CLAUDE_WELCOME_MSG];
      const updatedMsgs = trimMessages([...stashedMsgs, { id: Date.now() + Math.random(), ...action.msg }]);
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
      const updatedMsgs = trimMessages([...stashedMsgs, { id: Date.now() + Math.random(), ...action.msg }]);
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
      const updatedMsgs = trimMessages(action.updater(stashedMsgs));
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
      // Remove from dashboardList and auto-switch if this was the active dashboard
      const newDashList = state.dashboardList.filter(id => id !== rid);
      let switchState = {};
      if (state.currentDashboardId === rid && newDashList.length > 0) {
        const prevTabId = state.claudeActiveTabId;
        const prevStashKey = rid + ':' + prevTabId;
        const stashedTabStash = { ...newTabStash, [prevStashKey]: state.claudeMessages };
        const stashedActiveTabMap = { ...newActiveTabMap, [rid]: prevTabId };
        const stashedProcStash = { ...newProcStash2, [rid]: {
          isProcessing: state.claudeIsProcessing,
          status: state.claudeStatus,
          pendingAttachments: state.claudePendingAttachments,
          viewMode: state.claudeViewMode,
          chatOpen: state.activeView === 'claude',
          ideChatOpen: state.ideChatOpen,
        }};
        try { localStorage.setItem(claudeMessagesKey(rid, prevTabId), JSON.stringify(state.claudeMessages)); } catch (e) { /* */ }
        const targetId = newDashList[0];
        const targetTabId = stashedActiveTabMap[targetId] || 'default';
        const targetStashKey = targetId + ':' + targetTabId;
        const targetMessages = stashedTabStash[targetStashKey] || loadSavedMessages(targetId, targetTabId) || [CLAUDE_WELCOME_MSG];
        const targetProc = stashedProcStash[targetId] || {};
        const targetTabs2 = state.claudeTabs[targetId] || loadSavedTabs(targetId) || [{ ...DEFAULT_TAB }];
        switchState = {
          currentDashboardId: targetId,
          claudeTabStash: stashedTabStash,
          claudeActiveTabMap: stashedActiveTabMap,
          claudeActiveTabId: targetTabId,
          claudeTabs: { ...newTabs, [targetId]: targetTabs2 },
          claudeProcessingStash: stashedProcStash,
          claudeMessages: targetMessages,
          claudeIsProcessing: targetProc.isProcessing || false,
          claudeStatus: targetProc.status || 'Ready',
          claudePendingAttachments: targetProc.pendingAttachments || [],
          claudeDashboardId: targetId,
        };
      }
      return {
        ...state,
        dashboardList: newDashList,
        dashboardStates: newDashStates,
        dashboardNames: newDashNames,
        allDashboardProgress: newAllProgress,
        allDashboardLogs: newAllLogs,
        claudeTabStash: newTabStash,
        claudeTabs: newTabs,
        claudeActiveTabMap: newActiveTabMap,
        claudeProcessingStash: newProcStash2,
        unreadChatCounts: newUnread,
        ...switchState,
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
      // Never auto-switch dashboards here — list updates should not navigate.
      // Dashboard switching is handled by SWITCH_DASHBOARD (user click),
      // REMOVE_DASHBOARD (deletion), and workspace sync effects in IDEView.
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
    case 'IDE_LINK_WORKSPACE_DASHBOARD': {
      const updatedWorkspaces = state.ideWorkspaces.map(w =>
        w.id === action.workspaceId ? { ...w, dashboardId: action.dashboardId } : w
      );
      saveWorkspaces(updatedWorkspaces);
      return { ...state, ideWorkspaces: updatedWorkspaces };
    }
    case 'IDE_SET_FILE_TREE': {
      const newFileTrees = { ...state.ideFileTrees, [action.workspaceId]: action.tree };
      return { ...state, ideFileTrees: newFileTrees };
    }
    case 'IDE_UPDATE_FILE_TREE_NODE': {
      const currentTree = state.ideFileTrees[action.workspaceId];
      if (!currentTree) return state;
      const updatedTree = updateTreeNode(currentTree, action.nodePath, action.children);
      return { ...state, ideFileTrees: { ...state.ideFileTrees, [action.workspaceId]: updatedTree } };
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
    // --- IDE Search state ---
    case 'IDE_SET_SEARCH_QUERY':
      return { ...state, ideSearchQuery: action.query };
    case 'IDE_SET_SEARCH_OPTIONS':
      return { ...state, ideSearchOptions: { ...state.ideSearchOptions, ...action.options } };
    case 'IDE_SET_SEARCH_RESULTS':
      return {
        ...state,
        ideSearchResults: action.results,
        ideSearchTotalMatches: action.totalMatches || 0,
        ideSearchTruncated: action.truncated || false,
        ideSearchLoading: false,
      };
    case 'IDE_SET_SEARCH_LOADING':
      return { ...state, ideSearchLoading: action.value };
    case 'IDE_CLEAR_SEARCH':
      return {
        ...state,
        ideSearchQuery: '',
        ideSearchResults: null,
        ideSearchLoading: false,
        ideSearchTotalMatches: 0,
        ideSearchTruncated: false,
      };
    case 'IDE_SET_SEARCH_REPLACE_MODE':
      return { ...state, ideSearchReplaceMode: action.value };
    case 'IDE_SET_SEARCH_REPLACE_TEXT':
      return { ...state, ideSearchReplaceText: action.text };
    // --- Git Manager state management ---
    case 'GIT_OPEN_REPO': {
      const repoId = action.id || String(Date.now());
      const newRepo = { id: repoId, path: action.path, name: action.name };
      // Check if this path is already open
      const existingRepo = state.gitRepos.find(r => r.path === action.path);
      if (existingRepo) {
        return { ...state, gitActiveRepoId: existingRepo.id };
      }
      const updatedGitRepos = [...state.gitRepos, newRepo];
      saveGitRepos(updatedGitRepos);
      return {
        ...state,
        gitRepos: updatedGitRepos,
        gitActiveRepoId: repoId,
        gitStatus: null,
        gitBranches: [],
        gitCurrentBranch: null,
        gitLog: [],
        gitDiff: null,
        gitRemotes: [],
        gitError: null,
        gitSelectedFile: null,
      };
    }
    case 'GIT_CLOSE_REPO': {
      const closingRepoId = action.repoId;
      const updatedGitRepos = state.gitRepos.filter(r => r.id !== closingRepoId);
      let newActiveRepoId = state.gitActiveRepoId;
      if (newActiveRepoId === closingRepoId) {
        if (updatedGitRepos.length > 0) {
          const closedIdx = state.gitRepos.findIndex(r => r.id === closingRepoId);
          const newIdx = Math.min(closedIdx, updatedGitRepos.length - 1);
          newActiveRepoId = updatedGitRepos[newIdx].id;
        } else {
          newActiveRepoId = null;
        }
      }
      saveGitRepos(updatedGitRepos);
      return {
        ...state,
        gitRepos: updatedGitRepos,
        gitActiveRepoId: newActiveRepoId,
        gitStatus: newActiveRepoId !== state.gitActiveRepoId ? null : state.gitStatus,
        gitBranches: newActiveRepoId !== state.gitActiveRepoId ? [] : state.gitBranches,
        gitCurrentBranch: newActiveRepoId !== state.gitActiveRepoId ? null : state.gitCurrentBranch,
        gitLog: newActiveRepoId !== state.gitActiveRepoId ? [] : state.gitLog,
        gitDiff: newActiveRepoId !== state.gitActiveRepoId ? null : state.gitDiff,
        gitRemotes: newActiveRepoId !== state.gitActiveRepoId ? [] : state.gitRemotes,
        gitError: null,
        gitSelectedFile: newActiveRepoId !== state.gitActiveRepoId ? null : state.gitSelectedFile,
      };
    }
    case 'GIT_SWITCH_REPO': {
      if (action.repoId === state.gitActiveRepoId) return state;
      return {
        ...state,
        gitActiveRepoId: action.repoId,
        gitStatus: null,
        gitBranches: [],
        gitCurrentBranch: null,
        gitLog: [],
        gitDiff: null,
        gitRemotes: [],
        gitError: null,
        gitSelectedFile: null,
      };
    }
    case 'GIT_SET_STATUS':
      return { ...state, gitStatus: action.status };
    case 'GIT_SET_BRANCHES':
      return { ...state, gitBranches: action.branches };
    case 'GIT_SET_CURRENT_BRANCH':
      return { ...state, gitCurrentBranch: action.branch };
    case 'GIT_SET_LOG':
      return { ...state, gitLog: action.log };
    case 'GIT_SET_DIFF':
      return { ...state, gitDiff: action.diff };
    case 'GIT_SET_REMOTES':
      return { ...state, gitRemotes: action.remotes };
    case 'GIT_SET_LOADING':
      return { ...state, gitLoading: action.value };
    case 'GIT_SET_ERROR':
      return { ...state, gitError: action.error };
    case 'GIT_SET_SELECTED_FILE':
      return { ...state, gitSelectedFile: action.filePath };
    case 'GIT_NAVIGATE_TO_FILE': {
      // Opens (or selects) the repo at action.projectRoot, switches to git view,
      // and highlights action.filePath in the Changes panel.
      const navPath = action.projectRoot;
      const navFile = action.filePath;
      if (!navPath) return { ...state, activeView: 'git' };

      // Check if this repo is already open
      const existingNavRepo = state.gitRepos.find(r => r.path === navPath);
      if (existingNavRepo) {
        return {
          ...state,
          activeView: 'git',
          gitActiveRepoId: existingNavRepo.id,
          gitSelectedFile: navFile || null,
        };
      }

      // Open the repo as a new tab
      const navRepoId = String(Date.now());
      const navRepoName = navPath.replace(/\/+$/, '').split('/').pop();
      const newNavRepo = { id: navRepoId, path: navPath, name: navRepoName };
      const updatedNavRepos = [...state.gitRepos, newNavRepo];
      saveGitRepos(updatedNavRepos);
      return {
        ...state,
        activeView: 'git',
        gitRepos: updatedNavRepos,
        gitActiveRepoId: navRepoId,
        gitStatus: null,
        gitBranches: [],
        gitCurrentBranch: null,
        gitLog: [],
        gitDiff: null,
        gitRemotes: [],
        gitError: null,
        gitSelectedFile: navFile || null,
      };
    }
    // --- Debug state management ---
    case 'DEBUG_SET_SESSION': {
      const newSession = { ...state.debugSession, ...action.session };
      return { ...state, debugSession: newSession };
    }
    case 'DEBUG_TOGGLE_BREAKPOINT': {
      const filePath = action.filePath;
      const line = action.line;
      const currentBps = state.debugBreakpoints[filePath] || [];
      const idx = currentBps.indexOf(line);
      const newBps = idx === -1
        ? [...currentBps, line].sort((a, b) => a - b)
        : currentBps.filter(l => l !== line);
      const newBreakpoints = { ...state.debugBreakpoints, [filePath]: newBps };
      // Clean up empty arrays
      if (newBps.length === 0) {
        delete newBreakpoints[filePath];
      }
      return { ...state, debugBreakpoints: newBreakpoints };
    }
    case 'DEBUG_SET_BREAKPOINTS': {
      const newBreakpoints = { ...state.debugBreakpoints, [action.filePath]: action.breakpoints };
      return { ...state, debugBreakpoints: newBreakpoints };
    }
    case 'DEBUG_SET_CALL_STACK':
      return { ...state, debugCallStack: action.callStack };
    case 'DEBUG_SET_VARIABLES': {
      const newVars = { ...state.debugVariables, [action.scopeId]: action.variables };
      return { ...state, debugVariables: newVars };
    }
    case 'DEBUG_SET_SCOPES':
      return { ...state, debugScopes: action.scopes };
    case 'DEBUG_CLEAR_SESSION':
      return {
        ...state,
        debugSession: { status: 'idle', pausedFile: null, pausedLine: null, threadId: null },
        debugCallStack: [],
        debugVariables: {},
        debugScopes: [],
      };
    // --- Diagnostics state management ---
    case 'DIAGNOSTICS_SET': {
      const newDiagnostics = { ...state.diagnostics, [action.filePath]: action.diagnostics };
      return { ...state, diagnostics: newDiagnostics };
    }
    case 'DIAGNOSTICS_CLEAR':
      return { ...state, diagnostics: {} };
    case 'DIAGNOSTICS_CLEAR_FILE': {
      const newDiagnostics = { ...state.diagnostics };
      delete newDiagnostics[action.filePath];
      return { ...state, diagnostics: newDiagnostics };
    }
    default:
      return state;
  }
}

const CLAUDE_PERSIST_ACTIONS = new Set(['CLAUDE_SET_MESSAGES', 'CLAUDE_APPEND_MSG', 'CLAUDE_UPDATE_MESSAGES']);

// Debounced localStorage persistence — avoids serializing on every streaming delta
let persistTimer = null;
function schedulePersist(dashboardId, tabId, messages) {
  if (!dashboardId) return;
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
