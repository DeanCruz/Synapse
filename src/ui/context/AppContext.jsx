// AppContext — Central state management via React Context + useReducer
// Replaces the old AppState.js observable container.

import React, { createContext, useContext, useReducer, useCallback } from 'react';

const AppContext = createContext(null);
const DispatchContext = createContext(null);

const CLAUDE_MESSAGES_KEY_PREFIX = 'synapse-claude-messages-';
const CLAUDE_TABS_KEY_PREFIX = 'synapse-claude-tabs-';
const CLAUDE_WELCOME_MSG = { id: 'welcome', type: 'system', text: 'Agent chat is ready. Type a message below to start.' };
const DEFAULT_TAB = { id: 'default', name: 'Chat 1' };

function claudeMessagesKey(dashboardId, tabId) {
  const base = CLAUDE_MESSAGES_KEY_PREFIX + (dashboardId || 'dashboard1');
  if (tabId && tabId !== 'default') return base + '-' + tabId;
  return base;
}

function claudeTabsKey(dashboardId) {
  return CLAUDE_TABS_KEY_PREFIX + (dashboardId || 'dashboard1');
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

const initialState = {
  currentDashboardId: 'dashboard1',
  currentInit: null,
  currentProgress: {},
  currentLogs: null,
  currentStatus: null,
  dashboardList: [],
  dashboardStates: {},
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
  // Per-dashboard caches for sidebar state derivation
  allDashboardProgress: {},
  allDashboardLogs: {},
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
      return {
        ...state,
        currentDashboardId: action.id,
        currentInit: null,
        currentProgress: {},
        currentLogs: null,
        currentStatus: null,
        activeLogFilter: 'all',
        seenPermissionCount: 0,
        activeView: state.activeView === 'claude' ? 'claude' : 'dashboard',
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
      };
    }
    case 'SET_VIEW':
      return {
        ...state,
        activeView: action.view,
        claudeDashboardId: action.dashboardId || state.claudeDashboardId || state.currentDashboardId,
        // Once opened, keep mounted forever for background persistence
        claudeEverOpened: state.claudeEverOpened || action.view === 'claude',
      };
    case 'OPEN_MODAL':
      return { ...state, activeModal: action.modal, modalDashboardId: action.dashboardId || state.currentDashboardId };
    case 'CLOSE_MODAL':
      return { ...state, activeModal: null };
    case 'CLAUDE_SET_MESSAGES':
      return { ...state, claudeMessages: action.messages };
    case 'CLAUDE_APPEND_MSG':
      return { ...state, claudeMessages: [...state.claudeMessages, { id: Date.now() + Math.random(), ...action.msg }] };
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
      return { ...state, claudeTabStash: newTabStash };
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
      return {
        ...state,
        dashboardStates: newDashStates,
        allDashboardProgress: newAllProgress,
        allDashboardLogs: newAllLogs,
        claudeTabStash: newTabStash,
        claudeTabs: newTabs,
        claudeActiveTabMap: newActiveTabMap,
        claudeProcessingStash: newProcStash2,
      };
    }
    case 'CLAUDE_STASH_SET_PROCESSING': {
      const did = action.dashboardId;
      const existing = state.claudeProcessingStash[did] || {};
      const newProcStash = { ...state.claudeProcessingStash, [did]: { ...existing, isProcessing: action.value, status: action.status || existing.status || 'Ready' } };
      return { ...state, claudeProcessingStash: newProcStash };
    }
    case 'SET_UNBLOCKED_TASKS':
      return { ...state, unblockedTasks: action.tasks || [] };
    case 'CLEAR_UNBLOCKED_TASKS':
      return { ...state, unblockedTasks: [] };
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
