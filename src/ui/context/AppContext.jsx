// AppContext — Central state management via React Context + useReducer
// Replaces the old AppState.js observable container.

import React, { createContext, useContext, useReducer, useCallback } from 'react';

const AppContext = createContext(null);
const DispatchContext = createContext(null);

const CLAUDE_MESSAGES_KEY_PREFIX = 'synapse-claude-messages-';
const CLAUDE_WELCOME_MSG = { id: 'welcome', type: 'system', text: 'Agent chat is ready. Type a message below to start.' };

function claudeMessagesKey(dashboardId) {
  return CLAUDE_MESSAGES_KEY_PREFIX + (dashboardId || 'dashboard1');
}

function loadSavedMessages(dashboardId) {
  try {
    const key = claudeMessagesKey(dashboardId);
    const raw = localStorage.getItem(key);
    if (!raw) {
      // Migration: move old global key to dashboard1
      if (!dashboardId || dashboardId === 'dashboard1') {
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
  claudeChatStash: {}, // { [dashboardId]: messages } — in-memory cache for fast dashboard switching
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
      // Stash current dashboard's chat messages
      const stash = { ...state.claudeChatStash, [state.currentDashboardId]: state.claudeMessages };
      // Restore target dashboard's chat messages
      const targetMessages = stash[action.id] || loadSavedMessages(action.id) || [CLAUDE_WELCOME_MSG];
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
        // Swap chat state
        claudeChatStash: stash,
        claudeMessages: targetMessages,
        claudeIsProcessing: false,
        claudeStatus: 'Ready',
        claudePendingAttachments: [],
        claudeDashboardId: action.id,
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
      try { localStorage.removeItem(claudeMessagesKey(state.currentDashboardId)); } catch (e) { /* unavailable */ }
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
    default:
      return state;
  }
}

const CLAUDE_PERSIST_ACTIONS = new Set(['CLAUDE_SET_MESSAGES', 'CLAUDE_APPEND_MSG', 'CLAUDE_UPDATE_MESSAGES']);

function appReducer(state, action) {
  const newState = appReducerCore(state, action);
  if (CLAUDE_PERSIST_ACTIONS.has(action.type)) {
    try {
      localStorage.setItem(claudeMessagesKey(newState.currentDashboardId), JSON.stringify(newState.claudeMessages));
    } catch (e) { /* quota exceeded or private browsing */ }
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
