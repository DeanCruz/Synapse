// AppContext — Central state management via React Context + useReducer
// Replaces the old AppState.js observable container.

import React, { createContext, useContext, useReducer, useCallback, useEffect, useRef } from 'react';

const AppContext = createContext(null);
const DispatchContext = createContext(null);

const CLAUDE_MESSAGES_KEY_PREFIX = 'synapse-claude-messages-';
const CLAUDE_TABS_KEY_PREFIX = 'synapse-claude-tabs-';
const CLAUDE_WELCOME_MSG = { id: 'welcome', type: 'system', text: 'Agent chat is ready. Type a message below to start.' };
const DEFAULT_TAB = { id: 'default', name: 'Chat 1' };
const MAX_CHAT_MESSAGES = 200; // Hard cap on in-memory message count per tab

const CHAT_TABS_KEY = 'synapse-chat-tabs';
const CHAT_TAB_MESSAGES_KEY_PREFIX = 'synapse-chat-tab-messages-';
const CHAT_TAB_ACTIVE_KEY = 'synapse-chat-active-tab';

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

function migrateFlatTabToProject(tab) {
  const subId = 'sub-' + Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  const projectName = tab.projectPath
    ? tab.projectPath.replace(/\/+$/, '').split('/').pop() || 'Project'
    : tab.name || 'Chat';
  return {
    id: tab.id,
    name: projectName,
    projectPath: tab.projectPath || null,
    subtabs: [{
      id: subId,
      name: tab.name || 'Chat 1',
      agentHex: tab.agentHex || null,
      chatNumber: tab.chatNumber || null,
    }],
    activeSubTabId: subId,
  };
}

function loadSavedChatTabs() {
  try {
    const raw = localStorage.getItem(CHAT_TABS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      if (parsed.length > 0 && !parsed[0].subtabs) {
        const migrated = parsed.map(migrateFlatTabToProject);
        saveChatTabs(migrated);
        return migrated;
      }
      return parsed;
    }
  } catch (e) { /* corrupt or unavailable */ }
  return [];
}

function saveChatTabs(tabs) {
  try { localStorage.setItem(CHAT_TABS_KEY, JSON.stringify(tabs)); } catch (e) { /* */ }
}

function chatTabMessagesKey(tabId) {
  return CHAT_TAB_MESSAGES_KEY_PREFIX + tabId;
}

function activeSubTab(tab) {
  if (!tab || !tab.subtabs) return null;
  return tab.subtabs.find(s => s.id === tab.activeSubTabId) || tab.subtabs[0] || null;
}

function chatTabContextId(tab) {
  if (!tab) return null;
  const sub = activeSubTab(tab);
  return sub?.agentHex ? 'chat-agent-' + sub.agentHex : tab.id;
}

function activeChatContextId(state) {
  if (!state.chatActiveTabId) return null;
  const tab = state.chatTabs.find(t => t.id === state.chatActiveTabId);
  return chatTabContextId(tab);
}

// ── Surface-aware slice routing ───────────────────────────────────────────
// Two parallel "slices" of Claude chat state coexist: the original code-side
// (`claude*`) and the new chat-side (`chatClaude*`). Reducer cases that touch
// any of these fields accept an optional `action.surface` ('code' | 'chat',
// default 'code') and use SLICE_FIELDS[surface] to pick the right state-key
// set. Existing dispatches without an action.surface keep writing to the
// code slice — backward-compatible.
const SLICE_FIELDS = {
  code: {
    messages: 'claudeMessages',
    isProcessing: 'claudeIsProcessing',
    status: 'claudeStatus',
    activeTabId: 'claudeActiveTabId',
    tabs: 'claudeTabs',
    tabStash: 'claudeTabStash',
    processingStash: 'claudeProcessingStash',
    activeTabMap: 'claudeActiveTabMap',
    pendingAttachments: 'claudePendingAttachments',
    dashboardId: 'claudeDashboardId',
  },
  chat: {
    messages: 'chatClaudeMessages',
    isProcessing: 'chatClaudeIsProcessing',
    status: 'chatClaudeStatus',
    activeTabId: 'chatClaudeActiveTabId',
    tabs: 'chatClaudeTabs',
    tabStash: 'chatClaudeTabStash',
    processingStash: 'chatClaudeProcessingStash',
    activeTabMap: 'chatClaudeActiveTabMap',
    pendingAttachments: 'chatClaudePendingAttachments',
    dashboardId: 'chatClaudeDashboardId',
  },
};

function fieldsFor(surface) {
  return SLICE_FIELDS[surface === 'chat' ? 'chat' : 'code'];
}

function loadChatTabMessages(tabId) {
  try {
    const raw = localStorage.getItem(chatTabMessagesKey(tabId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) { /* */ }
  return [];
}

function saveChatTabMessages(tabId, msgs) {
  try { localStorage.setItem(chatTabMessagesKey(tabId), JSON.stringify(msgs)); } catch (e) { /* */ }
}

function loadAllChatTabMessages(tabs) {
  const out = {};
  for (const t of tabs) out[t.id] = loadChatTabMessages(t.id);
  return out;
}

function loadSavedActiveChatTabId() {
  try {
    const raw = localStorage.getItem(CHAT_TAB_ACTIVE_KEY);
    return raw || null;
  } catch (e) { return null; }
}

const savedChatTabs = loadSavedChatTabs();
const savedChatActiveTabId = loadSavedActiveChatTabId();
const savedChatActiveTabIsValid = !!savedChatTabs.find(t => t.id === savedChatActiveTabId);

// Pre-load the restored chat tab's persisted messages and sub-tabs so the
// initial render shows that chat's history (not the welcome placeholder).
// Messages persisted under the chat-agent context id mirror the format used
// by code-mode dashboards via claudeMessagesKey(...). Bootstrap targets the
// CHAT surface slice (chatClaudeMessages / chatClaudeTabs) — the code-side
// claude* slice always boots clean to [CLAUDE_WELCOME_MSG] so it shows a
// fresh start when the user is in code mode.
const initialChatTab = savedChatActiveTabIsValid
  ? savedChatTabs.find(t => t.id === savedChatActiveTabId)
  : null;
const initialChatCtxId = chatTabContextId(initialChatTab);
const initialChatClaudeMessages = initialChatCtxId
  ? (loadSavedMessages(initialChatCtxId, 'default') || [CLAUDE_WELCOME_MSG])
  : [CLAUDE_WELCOME_MSG];
const initialChatClaudeTabs = initialChatCtxId
  ? { [initialChatCtxId]: loadSavedTabs(initialChatCtxId) || [{ ...DEFAULT_TAB }] }
  : {};

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
  archivedDashboard: null, // { name, taskName, init, progress, logs, status }
  queueViewActive: false,
  queueItems: [],
  unblockedTasks: [],
  priorDashboardId: null,
  activeLogFilter: 'all',
  activeStatFilter: null,
  seenPermissionCount: 0,
  pendingPermission: null, // { pid, toolName, toolInput, requestId, toolUseId, timestamp } — active permission request from a worker
  activeView: 'dashboard', // 'dashboard' | 'swarmBuilder' | 'claude' | 'ide' | 'git' | 'preview'
  appMode: 'chat', // 'code' | 'chat' — top-level mode selector
  chatActiveView: savedChatActiveTabIsValid ? 'chat-instance' : 'dashboard', // 'dashboard' | 'make' | 'chat-instance' — active view within Chat mode
  // Chat-mode user-created chat tabs (no dedicated dashboard)
  chatTabs: savedChatTabs, // [{ id, name }]
  chatActiveTabId: savedChatActiveTabIsValid ? savedChatActiveTabId : null,
  chatTabMessages: loadAllChatTabMessages(savedChatTabs), // { [tabId]: [{ id, role, text, ts }] }
  activeModal: null, // null | 'commands' | 'project' | 'settings' | 'planning' | 'taskEditor'
  modalDashboardId: null, // which dashboard a modal was opened for
  claudeDashboardId: null, // which dashboard the Claude view is associated with
  claudeViewMode: 'expanded', // 'minimized' | 'collapsed' | 'expanded' | 'maximized'
  claudeEverOpened: false,   // true once the Claude panel has been opened — keeps it mounted
  connected: false,
  // ── CODE-surface Claude chat state (per-dashboard) ────────────────────────
  // The "code" slice is bound to the active code-mode dashboard. It always
  // boots clean to [CLAUDE_WELCOME_MSG] so opening the Code tab from a fresh
  // session shows a placeholder instead of leaking the chat-agent transcript.
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
  // ── CHAT-surface Claude chat state (per-chat-agent) ───────────────────────
  // Parallel slice that powers the always-mounted chat-mode ClaudeView. Lets
  // chat and code views coexist without trampling each other's messages,
  // active tab, processing flag, or pending attachments. Bootstrapped from
  // the persisted chat-agent transcript when a chat tab was the last active
  // surface — see initialChatClaudeMessages above.
  chatClaudeMessages: initialChatClaudeMessages,
  chatClaudeTabStash: {}, // { [chatCtxId:tabId]: messages }
  chatClaudeProcessingStash: {}, // { [chatCtxId]: { isProcessing, status, pendingAttachments } }
  chatClaudeTabs: initialChatClaudeTabs, // { [chatCtxId]: [{ id, name }] }
  chatClaudeActiveTabId: 'default',
  chatClaudeActiveTabMap: {}, // { [chatCtxId]: tabId }
  chatClaudeIsProcessing: false,
  chatClaudeStatus: 'Ready',
  chatClaudePendingAttachments: [],
  chatClaudeDashboardId: null, // chat-agent context id currently bound to the chat-surface ClaudeView
  // Unread chat message counts per dashboard (for sidebar glow)
  unreadChatCounts: {},
  // Per-dashboard caches for sidebar state derivation
  allDashboardProgress: {},
  allDashboardLogs: {},
  // IDE state — open files, file trees, sidebar view (keyed by currentDashboardId)
  ideOpenFiles: {}, // { [dashboardId]: [{ id, path, name, isDirty }] }
  ideActiveFileId: {}, // { [dashboardId]: string }
  ideFileTrees: {}, // { [dashboardId]: treeData }
  ideRevealRequest: null, // { dashboardId, path, seq } — last "reveal in tree" request from chat or elsewhere
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
  // Git Manager state — git data per active dashboard, loading states
  gitStatus: null, // { staged: [], unstaged: [], untracked: [] }
  gitBranches: [], // [{ name, current, tracking, ahead, behind }]
  gitCurrentBranch: null, // string — name of current branch
  gitLog: [], // [{ hash, abbrevHash, author, date, message, parents, refs }]
  gitDiff: null, // string — current diff content
  gitRemotes: [], // [{ name, fetchUrl, pushUrl }]
  gitLoading: false, // boolean — global loading indicator
  gitError: null, // string | null — last error message
  gitSelectedFile: null, // string | null — currently selected file path for diff view
  // Preview state — live preview editor with label-based source mapping
  previewUrl: '',                    // Current preview URL
  previewIsLoading: false,           // Whether the webview is loading
  previewError: null,                // Error message if page failed to load
  previewEditHistory: [],            // Array of { label, oldText, newText, timestamp }
  previewLabelMap: {},               // { label: { file, line, text } } — cached label-to-source mapping
  previewInstrumentedProject: null,  // Path of the last instrumented project
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
    case 'SET_ARCHIVED_DASHBOARD':
      return { ...state, archivedDashboard: action.data };
    case 'CLEAR_ARCHIVED_DASHBOARD':
      return { ...state, archivedDashboard: null };
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
        archivedDashboard: null,
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
      // Clear archived dashboard when navigating away from dashboard view
      const clearArchive = action.view !== 'dashboard' && state.archivedDashboard
        ? null : state.archivedDashboard;
      return {
        ...state,
        activeView: action.view,
        archivedDashboard: clearArchive,
        claudeDashboardId: targetClaudeDash,
        claudeEverOpened: state.claudeEverOpened || action.view === 'claude',
        unreadChatCounts: clearedUnread,
      };
    }
    case 'SET_APP_MODE':
      return { ...state, appMode: action.mode };
    case 'SET_CHAT_VIEW': {
      return { ...state, chatActiveView: action.view };
    }
    case 'CHAT_TAB_CREATE': {
      // Creates a new project sidebar tab with its first subtab (agent).
      const usedIds = new Set(state.chatTabs.map(t => t.id));
      let id;
      do {
        id = 'chat-' + Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
      } while (usedIds.has(id));
      const subId = 'sub-' + Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
      const projectName = action.projectPath
        ? action.projectPath.replace(/\/+$/, '').split('/').pop() || 'Project'
        : 'Chat';
      const newTab = {
        id,
        name: projectName,
        projectPath: action.projectPath || null,
        subtabs: [{
          id: subId,
          name: 'Chat 1',
          agentHex: action.agentHex || null,
          chatNumber: action.chatNumber || null,
        }],
        activeSubTabId: subId,
      };
      const updatedTabs = [...state.chatTabs, newTab];
      saveChatTabs(updatedTabs);
      try { localStorage.setItem(CHAT_TAB_ACTIVE_KEY, id); } catch (e) { /* */ }

      const prevTabCreate = state.chatTabs.find(t => t.id === state.chatActiveTabId);
      const prevCtxIdCreate = chatTabContextId(prevTabCreate);
      const prevSubTabIdCreate = state.chatClaudeActiveTabId;
      const newTabStashCreate = prevCtxIdCreate
        ? { ...state.chatClaudeTabStash, [prevCtxIdCreate + ':' + prevSubTabIdCreate]: state.chatClaudeMessages }
        : state.chatClaudeTabStash;
      const newActiveTabMapCreate = prevCtxIdCreate
        ? { ...state.chatClaudeActiveTabMap, [prevCtxIdCreate]: prevSubTabIdCreate }
        : state.chatClaudeActiveTabMap;
      const procStashCreate = prevCtxIdCreate
        ? { ...state.chatClaudeProcessingStash, [prevCtxIdCreate]: {
            isProcessing: state.chatClaudeIsProcessing,
            status: state.chatClaudeStatus,
            pendingAttachments: state.chatClaudePendingAttachments,
          } }
        : state.chatClaudeProcessingStash;
      if (prevCtxIdCreate) {
        try { localStorage.setItem(claudeMessagesKey(prevCtxIdCreate, prevSubTabIdCreate), JSON.stringify(state.chatClaudeMessages)); } catch (e) { /* */ }
      }

      const newCtxId = chatTabContextId(newTab);
      return {
        ...state,
        chatTabs: updatedTabs,
        chatTabMessages: { ...state.chatTabMessages, [id]: [] },
        chatActiveTabId: id,
        chatActiveView: 'chat-instance',
        chatClaudeTabStash: newTabStashCreate,
        chatClaudeActiveTabMap: newActiveTabMapCreate,
        chatClaudeActiveTabId: 'default',
        chatClaudeTabs: newCtxId
          ? { ...state.chatClaudeTabs, [newCtxId]: [{ ...DEFAULT_TAB }] }
          : state.chatClaudeTabs,
        chatClaudeProcessingStash: procStashCreate,
        chatClaudeMessages: [CLAUDE_WELCOME_MSG],
        chatClaudeIsProcessing: false,
        chatClaudeStatus: 'Ready',
        chatClaudePendingAttachments: [],
        chatClaudeDashboardId: newCtxId,
      };
    }
    case 'CHAT_SUBTAB_CREATE': {
      // Creates a new agent subtab within the active project tab.
      const projectTab = state.chatTabs.find(t => t.id === state.chatActiveTabId);
      if (!projectTab) return state;
      const subId = 'sub-' + Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
      const existingNums = projectTab.subtabs
        .map(s => /^Chat (\d+)$/.exec(s.name))
        .filter(Boolean)
        .map(m => parseInt(m[1], 10));
      const nextNum = existingNums.length > 0 ? Math.max(...existingNums) + 1 : 1;
      const newSub = {
        id: subId,
        name: 'Chat ' + nextNum,
        agentHex: action.agentHex || null,
        chatNumber: action.chatNumber || null,
      };

      // Stash current subtab's chat state before switching.
      const prevCtxIdSub = chatTabContextId(projectTab);
      const prevClaudeTabId = state.chatClaudeActiveTabId;
      const stashSub = prevCtxIdSub
        ? { ...state.chatClaudeTabStash, [prevCtxIdSub + ':' + prevClaudeTabId]: state.chatClaudeMessages }
        : state.chatClaudeTabStash;
      const activeMapSub = prevCtxIdSub
        ? { ...state.chatClaudeActiveTabMap, [prevCtxIdSub]: prevClaudeTabId }
        : state.chatClaudeActiveTabMap;
      const procStashSub = prevCtxIdSub
        ? { ...state.chatClaudeProcessingStash, [prevCtxIdSub]: {
            isProcessing: state.chatClaudeIsProcessing,
            status: state.chatClaudeStatus,
            pendingAttachments: state.chatClaudePendingAttachments,
          } }
        : state.chatClaudeProcessingStash;
      if (prevCtxIdSub) {
        try { localStorage.setItem(claudeMessagesKey(prevCtxIdSub, prevClaudeTabId), JSON.stringify(state.chatClaudeMessages)); } catch (e) { /* */ }
      }

      const updatedProjectTab = {
        ...projectTab,
        subtabs: [...projectTab.subtabs, newSub],
        activeSubTabId: subId,
      };
      const updatedTabs = state.chatTabs.map(t => t.id === projectTab.id ? updatedProjectTab : t);
      saveChatTabs(updatedTabs);

      const newCtxId = newSub.agentHex ? 'chat-agent-' + newSub.agentHex : projectTab.id;
      return {
        ...state,
        chatTabs: updatedTabs,
        chatClaudeTabStash: stashSub,
        chatClaudeActiveTabMap: activeMapSub,
        chatClaudeActiveTabId: 'default',
        chatClaudeTabs: { ...state.chatClaudeTabs, [newCtxId]: [{ ...DEFAULT_TAB }] },
        chatClaudeProcessingStash: procStashSub,
        chatClaudeMessages: [CLAUDE_WELCOME_MSG],
        chatClaudeIsProcessing: false,
        chatClaudeStatus: 'Ready',
        chatClaudePendingAttachments: [],
        chatClaudeDashboardId: newCtxId,
      };
    }
    case 'CHAT_SUBTAB_SWITCH': {
      // Switch active subtab within the current project tab.
      const projectTab = state.chatTabs.find(t => t.id === state.chatActiveTabId);
      if (!projectTab) return state;
      const targetSub = projectTab.subtabs.find(s => s.id === action.subTabId);
      if (!targetSub) return state;
      if (action.subTabId === projectTab.activeSubTabId) return state;

      const prevCtxId = chatTabContextId(projectTab);
      const targetCtxId = targetSub.agentHex ? 'chat-agent-' + targetSub.agentHex : projectTab.id;
      const prevClaudeTabId = state.chatClaudeActiveTabId;

      // Stash current subtab state.
      const stash = prevCtxId
        ? { ...state.chatClaudeTabStash, [prevCtxId + ':' + prevClaudeTabId]: state.chatClaudeMessages }
        : state.chatClaudeTabStash;
      const activeMap = prevCtxId
        ? { ...state.chatClaudeActiveTabMap, [prevCtxId]: prevClaudeTabId }
        : state.chatClaudeActiveTabMap;
      const procStash = prevCtxId
        ? { ...state.chatClaudeProcessingStash, [prevCtxId]: {
            isProcessing: state.chatClaudeIsProcessing,
            status: state.chatClaudeStatus,
            pendingAttachments: state.chatClaudePendingAttachments,
          } }
        : state.chatClaudeProcessingStash;
      if (prevCtxId) {
        try { localStorage.setItem(claudeMessagesKey(prevCtxId, prevClaudeTabId), JSON.stringify(state.chatClaudeMessages)); } catch (e) { /* */ }
      }

      // Restore target subtab state.
      const targetClaudeTabId = activeMap[targetCtxId] || 'default';
      const targetStashKey = targetCtxId + ':' + targetClaudeTabId;
      const targetMessages = stash[targetStashKey]
        || loadSavedMessages(targetCtxId, targetClaudeTabId)
        || [CLAUDE_WELCOME_MSG];
      const targetProc = procStash[targetCtxId] || {};
      const targetClaudeTabs = state.chatClaudeTabs[targetCtxId]
        || loadSavedTabs(targetCtxId)
        || [{ ...DEFAULT_TAB }];

      // Clear unread for the target subtab.
      const clearedUnread = (({ [targetCtxId]: _, ...rest }) => rest)(state.unreadChatCounts);

      const updatedProjectTab = { ...projectTab, activeSubTabId: action.subTabId };
      const updatedTabs = state.chatTabs.map(t => t.id === projectTab.id ? updatedProjectTab : t);
      saveChatTabs(updatedTabs);

      return {
        ...state,
        chatTabs: updatedTabs,
        chatClaudeTabStash: stash,
        chatClaudeActiveTabMap: activeMap,
        chatClaudeActiveTabId: targetClaudeTabId,
        chatClaudeTabs: { ...state.chatClaudeTabs, [targetCtxId]: targetClaudeTabs },
        chatClaudeProcessingStash: procStash,
        chatClaudeMessages: targetMessages,
        chatClaudeIsProcessing: targetProc.isProcessing || false,
        chatClaudeStatus: targetProc.status || 'Ready',
        chatClaudePendingAttachments: targetProc.pendingAttachments || [],
        chatClaudeDashboardId: targetCtxId,
        unreadChatCounts: clearedUnread,
      };
    }
    case 'CHAT_SUBTAB_DELETE': {
      const projectTab = state.chatTabs.find(t => t.id === state.chatActiveTabId);
      if (!projectTab || projectTab.subtabs.length <= 1) return state;
      const deletedSub = projectTab.subtabs.find(s => s.id === action.subTabId);
      if (!deletedSub) return state;
      const deletedCtxId = deletedSub.agentHex ? 'chat-agent-' + deletedSub.agentHex : null;

      // Purge persisted state for the deleted subtab.
      let newTabStash = state.chatClaudeTabStash;
      let newClaudeTabs = state.chatClaudeTabs;
      let newActiveTabMap = state.chatClaudeActiveTabMap;
      let newProcStash = state.chatClaudeProcessingStash;
      if (deletedCtxId) {
        const subTabs = state.chatClaudeTabs[deletedCtxId] || [{ ...DEFAULT_TAB }];
        for (const t of subTabs) {
          try { localStorage.removeItem(claudeMessagesKey(deletedCtxId, t.id)); } catch (e) { /* */ }
        }
        try { localStorage.removeItem(claudeTabsKey(deletedCtxId)); } catch (e) { /* */ }
        newTabStash = Object.fromEntries(
          Object.entries(state.chatClaudeTabStash).filter(([k]) => !k.startsWith(deletedCtxId + ':'))
        );
        const { [deletedCtxId]: _a, ...restTabs } = state.chatClaudeTabs;
        newClaudeTabs = restTabs;
        const { [deletedCtxId]: _b, ...restMap } = state.chatClaudeActiveTabMap;
        newActiveTabMap = restMap;
        const { [deletedCtxId]: _c, ...restProc } = state.chatClaudeProcessingStash;
        newProcStash = restProc;
      }

      const remainingSubs = projectTab.subtabs.filter(s => s.id !== action.subTabId);
      const wasActive = projectTab.activeSubTabId === action.subTabId;
      const newActiveSubId = wasActive ? remainingSubs[0]?.id : projectTab.activeSubTabId;
      const updatedProjectTab = { ...projectTab, subtabs: remainingSubs, activeSubTabId: newActiveSubId };
      const updatedTabs = state.chatTabs.map(t => t.id === projectTab.id ? updatedProjectTab : t);
      saveChatTabs(updatedTabs);

      // If deleted subtab was active, restore the new active subtab's state.
      if (wasActive && newActiveSubId) {
        const newActiveSub = remainingSubs.find(s => s.id === newActiveSubId);
        const newCtxId = newActiveSub?.agentHex ? 'chat-agent-' + newActiveSub.agentHex : projectTab.id;
        const restoredTabId = newActiveTabMap[newCtxId] || 'default';
        const restoredMessages = newTabStash[newCtxId + ':' + restoredTabId]
          || loadSavedMessages(newCtxId, restoredTabId)
          || [CLAUDE_WELCOME_MSG];
        const restoredProc = newProcStash[newCtxId] || {};
        return {
          ...state,
          chatTabs: updatedTabs,
          chatClaudeTabStash: newTabStash,
          chatClaudeTabs: newClaudeTabs,
          chatClaudeActiveTabMap: newActiveTabMap,
          chatClaudeProcessingStash: newProcStash,
          chatClaudeMessages: restoredMessages,
          chatClaudeIsProcessing: restoredProc.isProcessing || false,
          chatClaudeStatus: restoredProc.status || 'Ready',
          chatClaudePendingAttachments: restoredProc.pendingAttachments || [],
          chatClaudeActiveTabId: restoredTabId,
          chatClaudeDashboardId: newCtxId,
        };
      }
      return {
        ...state,
        chatTabs: updatedTabs,
        chatClaudeTabStash: newTabStash,
        chatClaudeTabs: newClaudeTabs,
        chatClaudeActiveTabMap: newActiveTabMap,
        chatClaudeProcessingStash: newProcStash,
      };
    }
    case 'CHAT_TAB_SWITCH': {
      try { localStorage.setItem(CHAT_TAB_ACTIVE_KEY, action.tabId); } catch (e) { /* */ }
      // Same-tab click: just ensure the chat-instance view is active.
      if (action.tabId === state.chatActiveTabId) {
        const sameTab = state.chatTabs.find(t => t.id === action.tabId);
        const sameCtxId = chatTabContextId(sameTab);
        const sameUnread = sameCtxId
          ? (({ [sameCtxId]: _, ...rest }) => rest)(state.unreadChatCounts)
          : state.unreadChatCounts;
        return { ...state, chatActiveTabId: action.tabId, chatActiveView: 'chat-instance', unreadChatCounts: sameUnread };
      }

      const prevTab = state.chatTabs.find(t => t.id === state.chatActiveTabId);
      const targetTab = state.chatTabs.find(t => t.id === action.tabId);
      const prevCtxId = chatTabContextId(prevTab);
      const targetCtxId = chatTabContextId(targetTab);

      // No target context (e.g. legacy tab without agentHex that hasn't backfilled
      // yet) — fall back to the previous shallow update so we don't blow away
      // the current chat's messages with a fresh welcome.
      if (!targetCtxId) {
        return { ...state, chatActiveTabId: action.tabId, chatActiveView: 'chat-instance' };
      }

      // Reading the chat clears its unread badge.
      const clearedUnread = (({ [targetCtxId]: _, ...rest }) => rest)(state.unreadChatCounts);

      // Stash the previous chat tab's claude state under its context id.
      // Operates on the CHAT slice (chatClaude*) — code-side state is untouched
      // so the Code tab keeps showing its own dashboard's transcript.
      const prevSubTabId = state.chatClaudeActiveTabId;
      const newTabStash = prevCtxId
        ? { ...state.chatClaudeTabStash, [prevCtxId + ':' + prevSubTabId]: state.chatClaudeMessages }
        : state.chatClaudeTabStash;
      const newActiveTabMap = prevCtxId
        ? { ...state.chatClaudeActiveTabMap, [prevCtxId]: prevSubTabId }
        : state.chatClaudeActiveTabMap;
      const procStash = prevCtxId
        ? { ...state.chatClaudeProcessingStash, [prevCtxId]: {
            isProcessing: state.chatClaudeIsProcessing,
            status: state.chatClaudeStatus,
            pendingAttachments: state.chatClaudePendingAttachments,
          } }
        : state.chatClaudeProcessingStash;
      if (prevCtxId) {
        try { localStorage.setItem(claudeMessagesKey(prevCtxId, prevSubTabId), JSON.stringify(state.chatClaudeMessages)); } catch (e) { /* */ }
      }

      // Restore the target chat tab's claude state (in-memory stash → localStorage → welcome).
      const targetSubTabId = newActiveTabMap[targetCtxId] || 'default';
      const targetStashKey = targetCtxId + ':' + targetSubTabId;
      const targetMessages = newTabStash[targetStashKey]
        || loadSavedMessages(targetCtxId, targetSubTabId)
        || [CLAUDE_WELCOME_MSG];
      const targetProc = procStash[targetCtxId] || {};
      const targetSubTabs = state.chatClaudeTabs[targetCtxId]
        || loadSavedTabs(targetCtxId)
        || [{ ...DEFAULT_TAB }];

      return {
        ...state,
        chatActiveTabId: action.tabId,
        chatActiveView: 'chat-instance',
        chatClaudeTabStash: newTabStash,
        chatClaudeActiveTabMap: newActiveTabMap,
        chatClaudeActiveTabId: targetSubTabId,
        chatClaudeTabs: { ...state.chatClaudeTabs, [targetCtxId]: targetSubTabs },
        chatClaudeProcessingStash: procStash,
        chatClaudeMessages: targetMessages,
        chatClaudeIsProcessing: targetProc.isProcessing || false,
        chatClaudeStatus: targetProc.status || 'Ready',
        chatClaudePendingAttachments: targetProc.pendingAttachments || [],
        chatClaudeDashboardId: targetCtxId,
        unreadChatCounts: clearedUnread,
      };
    }
    case 'CHAT_TAB_DELETE': {
      const deletedTab = state.chatTabs.find(t => t.id === action.tabId);
      const updatedTabs = state.chatTabs.filter(t => t.id !== action.tabId);
      saveChatTabs(updatedTabs);
      try { localStorage.removeItem(chatTabMessagesKey(action.tabId)); } catch (e) { /* */ }
      const newMessages = { ...state.chatTabMessages };
      delete newMessages[action.tabId];

      // Purge ALL subtabs' persisted state for this project tab.
      let newTabStash = state.chatClaudeTabStash;
      let newClaudeTabs = state.chatClaudeTabs;
      let newActiveTabMap = state.chatClaudeActiveTabMap;
      let newProcStash = state.chatClaudeProcessingStash;
      if (deletedTab?.subtabs) {
        for (const sub of deletedTab.subtabs) {
          const ctxId = sub.agentHex ? 'chat-agent-' + sub.agentHex : null;
          if (!ctxId) continue;
          const cTabs = newClaudeTabs[ctxId] || [{ ...DEFAULT_TAB }];
          for (const t of cTabs) {
            try { localStorage.removeItem(claudeMessagesKey(ctxId, t.id)); } catch (e) { /* */ }
          }
          try { localStorage.removeItem(claudeTabsKey(ctxId)); } catch (e) { /* */ }
          newTabStash = Object.fromEntries(
            Object.entries(newTabStash).filter(([k]) => !k.startsWith(ctxId + ':'))
          );
          const { [ctxId]: _a, ...restTabs } = newClaudeTabs;
          newClaudeTabs = restTabs;
          const { [ctxId]: _b, ...restMap } = newActiveTabMap;
          newActiveTabMap = restMap;
          const { [ctxId]: _c, ...restProc } = newProcStash;
          newProcStash = restProc;
        }
      }

      const wasActive = state.chatActiveTabId === action.tabId;
      if (wasActive) {
        try { localStorage.removeItem(CHAT_TAB_ACTIVE_KEY); } catch (e) { /* */ }
      }
      return {
        ...state,
        chatTabs: updatedTabs,
        chatTabMessages: newMessages,
        chatActiveTabId: wasActive ? null : state.chatActiveTabId,
        chatActiveView: wasActive ? 'dashboard' : state.chatActiveView,
        chatClaudeTabStash: newTabStash,
        chatClaudeTabs: newClaudeTabs,
        chatClaudeActiveTabMap: newActiveTabMap,
        chatClaudeProcessingStash: newProcStash,
        chatClaudeMessages: wasActive ? [CLAUDE_WELCOME_MSG] : state.chatClaudeMessages,
        chatClaudeIsProcessing: wasActive ? false : state.chatClaudeIsProcessing,
        chatClaudeStatus: wasActive ? 'Ready' : state.chatClaudeStatus,
        chatClaudePendingAttachments: wasActive ? [] : state.chatClaudePendingAttachments,
        chatClaudeActiveTabId: wasActive ? 'default' : state.chatClaudeActiveTabId,
        chatClaudeDashboardId: wasActive ? null : state.chatClaudeDashboardId,
      };
    }
    case 'CHAT_TAB_RENAME': {
      const updatedTabs = state.chatTabs.map(t =>
        t.id === action.tabId ? { ...t, name: action.name } : t
      );
      saveChatTabs(updatedTabs);
      return { ...state, chatTabs: updatedTabs };
    }
    case 'CHAT_TAB_BACKFILL_AGENT': {
      // Attach an agent identity to a subtab that lacks one (e.g. after migration).
      const updatedTabs = state.chatTabs.map(t => {
        if (t.id !== action.tabId) return t;
        const subs = (t.subtabs || []).map((s, i) => {
          if (i === 0 && !s.agentHex) {
            return { ...s, agentHex: action.agentHex, chatNumber: action.chatNumber ?? s.chatNumber };
          }
          return s;
        });
        return { ...t, subtabs: subs };
      });
      saveChatTabs(updatedTabs);
      return { ...state, chatTabs: updatedTabs };
    }
    case 'CHAT_TAB_APPEND_MSG': {
      const tabId = action.tabId;
      const existing = state.chatTabMessages[tabId] || [];
      const newMsgs = [...existing, { id: Date.now() + '-' + Math.random().toString(36).slice(2, 6), ...action.msg }];
      saveChatTabMessages(tabId, newMsgs);
      return {
        ...state,
        chatTabMessages: { ...state.chatTabMessages, [tabId]: newMsgs },
      };
    }
    case 'CHAT_TAB_CLEAR_MSGS': {
      const tabId = action.tabId;
      saveChatTabMessages(tabId, []);
      return {
        ...state,
        chatTabMessages: { ...state.chatTabMessages, [tabId]: [] },
      };
    }
    case 'OPEN_MODAL':
      return { ...state, activeModal: action.modal, modalDashboardId: action.dashboardId || state.currentDashboardId };
    case 'CLOSE_MODAL':
      return { ...state, activeModal: null };
    case 'CLAUDE_SET_MESSAGES': {
      const f = fieldsFor(action.surface);
      return { ...state, [f.messages]: action.messages };
    }
    case 'CLAUDE_APPEND_MSG': {
      const f = fieldsFor(action.surface);
      const prev = state[f.messages];
      const newMessages = trimMessages([...prev, { id: Date.now() + Math.random(), ...action.msg }]);
      // Track unread if user isn't viewing this dashboard's chat (code-surface only —
      // chat-surface unread is tracked elsewhere via the chat tab context).
      const shouldTrackUnread = (action.surface !== 'chat')
        && action.msg.type === 'assistant'
        && state.activeView !== 'claude';
      const updatedUnread = (shouldTrackUnread && state.currentDashboardId)
        ? { ...state.unreadChatCounts, [state.currentDashboardId]: (state.unreadChatCounts[state.currentDashboardId] || 0) + 1 }
        : state.unreadChatCounts;
      return { ...state, [f.messages]: newMessages, unreadChatCounts: updatedUnread };
    }
    case 'CLAUDE_UPDATE_MESSAGES': {
      // Functional update: action.updater(prevMessages) => newMessages
      const f = fieldsFor(action.surface);
      return { ...state, [f.messages]: trimMessages(action.updater(state[f.messages])) };
    }
    case 'CLAUDE_CLEAR_MESSAGES': {
      const f = fieldsFor(action.surface);
      // Resolve the active context id for persistence cleanup.
      // Chat surface -> chat-agent ctx id; code surface -> currentDashboardId.
      const clearCtxId = action.surface === 'chat'
        ? activeChatContextId(state)
        : state.currentDashboardId;
      if (!clearCtxId) return state;
      try { localStorage.removeItem(claudeMessagesKey(clearCtxId, state[f.activeTabId])); } catch (e) { /* unavailable */ }
      return { ...state, [f.messages]: [CLAUDE_WELCOME_MSG], [f.pendingAttachments]: [] };
    }
    case 'CLAUDE_SET_VIEW_MODE':
      // viewMode is a global UI flag (shared between code/chat surfaces).
      return { ...state, claudeViewMode: action.mode };
    case 'CLAUDE_SET_PROCESSING': {
      const f = fieldsFor(action.surface);
      return { ...state, [f.isProcessing]: action.value };
    }
    case 'CLAUDE_SET_STATUS': {
      const f = fieldsFor(action.surface);
      return { ...state, [f.status]: action.value };
    }
    case 'CLAUDE_SET_TASK_ID':
      // Task id is global — only one worker can be active at a time per
      // OS-level Claude CLI process. No surface branch.
      return { ...state, claudeActiveTaskId: action.value };
    case 'CLAUDE_SET_DASHBOARD': {
      // Surface-aware dashboardId update. For code surface this mirrors
      // claudeDashboardId (set by SET_VIEW); for chat surface it tracks the
      // chat-agent context id currently bound to the chat-mode ClaudeView.
      const f = fieldsFor(action.surface);
      return { ...state, [f.dashboardId]: action.dashboardId || null };
    }
    case 'CLAUDE_ADD_ATTACHMENT': {
      // action.attachment = { id, name, type, dataUrl }
      const f = fieldsFor(action.surface);
      return { ...state, [f.pendingAttachments]: [...state[f.pendingAttachments], action.attachment] };
    }
    case 'CLAUDE_REMOVE_ATTACHMENT': {
      // action.id = attachment id to remove
      const f = fieldsFor(action.surface);
      return { ...state, [f.pendingAttachments]: state[f.pendingAttachments].filter(a => a.id !== action.id) };
    }
    case 'CLAUDE_CLEAR_ATTACHMENTS': {
      const f = fieldsFor(action.surface);
      return { ...state, [f.pendingAttachments]: [] };
    }
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
      const f = fieldsFor(action.surface);
      // Code surface: tabs are per-dashboard (state.currentDashboardId).
      // Chat surface: tabs are per-chat-agent (chatClaudeDashboardId, falls
      // back to deriving from the active chat tab).
      const did = action.surface === 'chat'
        ? (state.chatClaudeDashboardId || activeChatContextId(state))
        : state.currentDashboardId;
      if (!did) return state;
      const currentTabs = state[f.tabs][did] || [{ ...DEFAULT_TAB }];
      const newTabId = 'tab-' + Date.now();
      const newTabName = 'Chat ' + (currentTabs.length + 1);
      const updatedTabs = [...currentTabs, { id: newTabId, name: newTabName }];
      const stashKey = did + ':' + state[f.activeTabId];
      const newTabStash = { ...state[f.tabStash], [stashKey]: state[f.messages] };
      try { localStorage.setItem(claudeMessagesKey(did, state[f.activeTabId]), JSON.stringify(state[f.messages])); } catch (e) { /* */ }
      saveTabs(did, updatedTabs);
      return {
        ...state,
        [f.tabs]: { ...state[f.tabs], [did]: updatedTabs },
        [f.activeTabId]: newTabId,
        [f.tabStash]: newTabStash,
        [f.messages]: [CLAUDE_WELCOME_MSG],
        [f.pendingAttachments]: [],
      };
    }
    case 'CLAUDE_SWITCH_TAB': {
      const f = fieldsFor(action.surface);
      const did = action.surface === 'chat'
        ? (state.chatClaudeDashboardId || activeChatContextId(state))
        : state.currentDashboardId;
      if (!did) return state;
      const targetTabId = action.tabId;
      if (targetTabId === state[f.activeTabId]) return state;
      const stashKey = did + ':' + state[f.activeTabId];
      const newTabStash = { ...state[f.tabStash], [stashKey]: state[f.messages] };
      try { localStorage.setItem(claudeMessagesKey(did, state[f.activeTabId]), JSON.stringify(state[f.messages])); } catch (e) { /* */ }
      const targetStashKey = did + ':' + targetTabId;
      const targetMessages = newTabStash[targetStashKey] || loadSavedMessages(did, targetTabId) || [CLAUDE_WELCOME_MSG];
      return {
        ...state,
        [f.activeTabId]: targetTabId,
        [f.tabStash]: newTabStash,
        [f.messages]: targetMessages,
      };
    }
    case 'CLAUDE_CLOSE_TAB': {
      const f = fieldsFor(action.surface);
      const did = action.surface === 'chat'
        ? (state.chatClaudeDashboardId || activeChatContextId(state))
        : state.currentDashboardId;
      if (!did) return state;
      const currentTabs = state[f.tabs][did] || [{ ...DEFAULT_TAB }];
      if (currentTabs.length <= 1) return state;
      const closingTabId = action.tabId;
      const updatedTabs = currentTabs.filter(t => t.id !== closingTabId);
      const stashKey = did + ':' + closingTabId;
      const newTabStash = { ...state[f.tabStash] };
      delete newTabStash[stashKey];
      try { localStorage.removeItem(claudeMessagesKey(did, closingTabId)); } catch (e) { /* */ }
      saveTabs(did, updatedTabs);
      if (closingTabId === state[f.activeTabId]) {
        const closedIdx = currentTabs.findIndex(t => t.id === closingTabId);
        const newActive = updatedTabs[Math.min(closedIdx, updatedTabs.length - 1)];
        const targetStashKey = did + ':' + newActive.id;
        const targetMessages = newTabStash[targetStashKey] || loadSavedMessages(did, newActive.id) || [CLAUDE_WELCOME_MSG];
        return {
          ...state,
          [f.tabs]: { ...state[f.tabs], [did]: updatedTabs },
          [f.activeTabId]: newActive.id,
          [f.tabStash]: newTabStash,
          [f.messages]: targetMessages,
        };
      }
      return {
        ...state,
        [f.tabs]: { ...state[f.tabs], [did]: updatedTabs },
        [f.tabStash]: newTabStash,
      };
    }
    case 'CLAUDE_RENAME_TAB': {
      const f = fieldsFor(action.surface);
      const did = action.surface === 'chat'
        ? (state.chatClaudeDashboardId || activeChatContextId(state))
        : state.currentDashboardId;
      if (!did) return state;
      const currentTabs = state[f.tabs][did] || [{ ...DEFAULT_TAB }];
      const updatedTabs = currentTabs.map(t => t.id === action.tabId ? { ...t, name: action.name } : t);
      saveTabs(did, updatedTabs);
      return { ...state, [f.tabs]: { ...state[f.tabs], [did]: updatedTabs } };
    }
    // --- Stashed tab updates (for non-active tabs on same dashboard with running workers) ---
    case 'CLAUDE_TAB_STASH_APPEND_MSG': {
      const f = fieldsFor(action.surface);
      const did = action.surface === 'chat'
        ? (state.chatClaudeDashboardId || activeChatContextId(state))
        : state.currentDashboardId;
      if (!did) return state;
      const stashKey = did + ':' + action.tabId;
      const stashedMsgs = state[f.tabStash][stashKey] || loadSavedMessages(did, action.tabId) || [CLAUDE_WELCOME_MSG];
      const updatedMsgs = trimMessages([...stashedMsgs, { id: Date.now() + Math.random(), ...action.msg }]);
      const newTabStash = { ...state[f.tabStash], [stashKey]: updatedMsgs };
      try { localStorage.setItem(claudeMessagesKey(did, action.tabId), JSON.stringify(updatedMsgs)); } catch (e) { /* */ }
      return { ...state, [f.tabStash]: newTabStash };
    }
    case 'CLAUDE_TAB_STASH_UPDATE_MESSAGES': {
      const f = fieldsFor(action.surface);
      const did = action.surface === 'chat'
        ? (state.chatClaudeDashboardId || activeChatContextId(state))
        : state.currentDashboardId;
      if (!did) return state;
      const stashKey = did + ':' + action.tabId;
      const stashedMsgs = state[f.tabStash][stashKey] || loadSavedMessages(did, action.tabId) || [CLAUDE_WELCOME_MSG];
      const updatedMsgs = trimMessages(action.updater(stashedMsgs));
      const newTabStash = { ...state[f.tabStash], [stashKey]: updatedMsgs };
      try { localStorage.setItem(claudeMessagesKey(did, action.tabId), JSON.stringify(updatedMsgs)); } catch (e) { /* */ }
      return { ...state, [f.tabStash]: newTabStash };
    }
    // --- Stashed dashboard updates (for non-active dashboards with running workers) ---
    case 'CLAUDE_STASH_APPEND_MSG': {
      const f = fieldsFor(action.surface);
      const did = action.dashboardId;
      const activeTab = state[f.activeTabMap][did] || 'default';
      const stashKey = did + ':' + activeTab;
      const stashedMsgs = state[f.tabStash][stashKey] || loadSavedMessages(did, activeTab) || [CLAUDE_WELCOME_MSG];
      const updatedMsgs = trimMessages([...stashedMsgs, { id: Date.now() + Math.random(), ...action.msg }]);
      const newTabStash = { ...state[f.tabStash], [stashKey]: updatedMsgs };
      try { localStorage.setItem(claudeMessagesKey(did, activeTab), JSON.stringify(updatedMsgs)); } catch (e) { /* */ }
      // Track unread assistant messages for non-active dashboards (code surface only —
      // chat-surface unread is keyed by chat-tab context elsewhere).
      const unreadChatCounts = (action.surface !== 'chat' && action.msg.type === 'assistant')
        ? { ...state.unreadChatCounts, [did]: (state.unreadChatCounts[did] || 0) + 1 }
        : state.unreadChatCounts;
      return { ...state, [f.tabStash]: newTabStash, unreadChatCounts };
    }
    case 'CLAUDE_STASH_UPDATE_MESSAGES': {
      const f = fieldsFor(action.surface);
      const did = action.dashboardId;
      const activeTab = state[f.activeTabMap][did] || 'default';
      const stashKey = did + ':' + activeTab;
      const stashedMsgs = state[f.tabStash][stashKey] || loadSavedMessages(did, activeTab) || [CLAUDE_WELCOME_MSG];
      const updatedMsgs = trimMessages(action.updater(stashedMsgs));
      const newTabStash = { ...state[f.tabStash], [stashKey]: updatedMsgs };
      try { localStorage.setItem(claudeMessagesKey(did, activeTab), JSON.stringify(updatedMsgs)); } catch (e) { /* */ }
      return { ...state, [f.tabStash]: newTabStash };
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
      // Clean up IDE per-dashboard state (open files, active file, file tree)
      const newIdeOpenFiles = { ...state.ideOpenFiles };
      delete newIdeOpenFiles[rid];
      const newIdeActiveFileId = { ...state.ideActiveFileId };
      delete newIdeActiveFileId[rid];
      const newIdeFileTrees = { ...state.ideFileTrees };
      delete newIdeFileTrees[rid];
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
        ideOpenFiles: newIdeOpenFiles,
        ideActiveFileId: newIdeActiveFileId,
        ideFileTrees: newIdeFileTrees,
        ...switchState,
      };
    }
    case 'CLAUDE_STASH_SET_PROCESSING': {
      const f = fieldsFor(action.surface);
      const did = action.dashboardId;
      const existing = state[f.processingStash][did] || {};
      const newProcStash = { ...state[f.processingStash], [did]: { ...existing, isProcessing: action.value, status: action.status || existing.status || 'Ready' } };
      return { ...state, [f.processingStash]: newProcStash };
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
    // --- IDE state management (keyed by currentDashboardId) ---
    case 'IDE_SET_FILE_TREE': {
      const did = action.dashboardId || state.currentDashboardId;
      if (!did) return state;
      const newFileTrees = { ...state.ideFileTrees, [did]: action.tree };
      return { ...state, ideFileTrees: newFileTrees };
    }
    case 'IDE_UPDATE_FILE_TREE_NODE': {
      const did = action.dashboardId || state.currentDashboardId;
      if (!did) return state;
      const currentTree = state.ideFileTrees[did];
      if (!currentTree) return state;
      const updatedTree = updateTreeNode(currentTree, action.nodePath, action.children);
      return { ...state, ideFileTrees: { ...state.ideFileTrees, [did]: updatedTree } };
    }
    case 'IDE_MERGE_ROOT_ENTRIES': {
      // Refresh root-level entries while preserving lazy-loaded children of
      // existing directories. Used by the polling interval so user-expanded
      // subtrees don't collapse on every refresh.
      const did = action.dashboardId || state.currentDashboardId;
      if (!did) return state;
      const currentTree = state.ideFileTrees[did];
      const existingChildren = (currentTree && Array.isArray(currentTree.children)) ? currentTree.children : [];
      const existingByPath = new Map();
      for (const child of existingChildren) existingByPath.set(child.path, child);
      const mergedChildren = action.entries.map(entry => {
        const existing = existingByPath.get(entry.path);
        if (existing && existing.type === 'directory' && entry.type === 'directory' && Array.isArray(existing.children)) {
          return { ...entry, children: existing.children };
        }
        return entry;
      });
      const newTree = {
        name: action.rootName,
        path: action.rootPath,
        type: 'directory',
        children: mergedChildren,
      };
      return { ...state, ideFileTrees: { ...state.ideFileTrees, [did]: newTree } };
    }
    case 'IDE_OPEN_FILE': {
      const did = action.dashboardId || state.currentDashboardId;
      if (!did) return state;
      const currentFiles = state.ideOpenFiles[did] || [];
      // Check if the file is already open (by path)
      const existingFile = currentFiles.find(f => f.path === action.file.path);
      if (existingFile) {
        // Just switch to the existing file
        const newActiveFileId = { ...state.ideActiveFileId, [did]: existingFile.id };
        return { ...state, ideActiveFileId: newActiveFileId };
      }
      const fileId = String(Date.now()) + '-' + Math.random().toString(36).slice(2, 7);
      const newFile = { id: fileId, path: action.file.path, name: action.file.name, isDirty: false };
      const updatedFiles = [...currentFiles, newFile];
      const newOpenFiles = { ...state.ideOpenFiles, [did]: updatedFiles };
      const newActiveFileId = { ...state.ideActiveFileId, [did]: fileId };
      return { ...state, ideOpenFiles: newOpenFiles, ideActiveFileId: newActiveFileId };
    }
    case 'IDE_CLOSE_FILE': {
      const did = action.dashboardId || state.currentDashboardId;
      if (!did) return state;
      const currentFiles = state.ideOpenFiles[did] || [];
      const updatedFiles = currentFiles.filter(f => f.id !== action.fileId);
      const newOpenFiles = { ...state.ideOpenFiles, [did]: updatedFiles };
      // Switch to adjacent file if the closed one was active
      let newActiveId = state.ideActiveFileId[did];
      if (newActiveId === action.fileId) {
        if (updatedFiles.length > 0) {
          const closedIdx = currentFiles.findIndex(f => f.id === action.fileId);
          const newIdx = Math.min(closedIdx, updatedFiles.length - 1);
          newActiveId = updatedFiles[newIdx].id;
        } else {
          newActiveId = null;
        }
      }
      const newActiveFileId = { ...state.ideActiveFileId, [did]: newActiveId };
      return { ...state, ideOpenFiles: newOpenFiles, ideActiveFileId: newActiveFileId };
    }
    case 'IDE_SWITCH_FILE': {
      const did = action.dashboardId || state.currentDashboardId;
      if (!did) return state;
      const newActiveFileId = { ...state.ideActiveFileId, [did]: action.fileId };
      return { ...state, ideActiveFileId: newActiveFileId };
    }
    case 'IDE_MARK_FILE_DIRTY': {
      const did = action.dashboardId || state.currentDashboardId;
      if (!did) return state;
      const currentFiles = state.ideOpenFiles[did] || [];
      const updatedFiles = currentFiles.map(f =>
        f.id === action.fileId ? { ...f, isDirty: true } : f
      );
      const newOpenFiles = { ...state.ideOpenFiles, [did]: updatedFiles };
      return { ...state, ideOpenFiles: newOpenFiles };
    }
    case 'IDE_MARK_FILE_CLEAN': {
      const did = action.dashboardId || state.currentDashboardId;
      if (!did) return state;
      const currentFiles = state.ideOpenFiles[did] || [];
      const updatedFiles = currentFiles.map(f =>
        f.id === action.fileId ? { ...f, isDirty: false } : f
      );
      const newOpenFiles = { ...state.ideOpenFiles, [did]: updatedFiles };
      return { ...state, ideOpenFiles: newOpenFiles };
    }
    case 'IDE_REVEAL_FILE': {
      const did = action.dashboardId || state.currentDashboardId;
      if (!did || !action.path) return state;
      const seq = (state.ideRevealRequest?.seq || 0) + 1;
      return { ...state, ideRevealRequest: { dashboardId: did, path: action.path, seq } };
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
      // Switches to git view and highlights action.filePath in the Changes
      // panel. Repo identity is now derived from the currently-active dashboard
      // (via getDashboardProject(currentDashboardId)) — we no longer maintain a
      // parallel repo tab list.
      return {
        ...state,
        activeView: 'git',
        gitSelectedFile: action.filePath || null,
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
    // --- Preview state management ---
    case 'PREVIEW_SET_URL':
      return { ...state, previewUrl: action.url };
    case 'PREVIEW_SET_LOADING':
      return { ...state, previewIsLoading: action.value };
    case 'PREVIEW_SET_ERROR':
      return { ...state, previewError: action.error };
    case 'PREVIEW_ADD_EDIT': {
      const updatedHistory = [...state.previewEditHistory, action.edit];
      // Cap at 100 entries — drop oldest
      return { ...state, previewEditHistory: updatedHistory.length > 100 ? updatedHistory.slice(-100) : updatedHistory };
    }
    case 'PREVIEW_SET_LABEL_MAP':
      return { ...state, previewLabelMap: action.map };
    case 'PREVIEW_SET_INSTRUMENTED':
      return { ...state, previewInstrumentedProject: action.path };
    case 'PREVIEW_CLEAR':
      return {
        ...state,
        previewUrl: '',
        previewIsLoading: false,
        previewError: null,
        previewEditHistory: [],
        previewLabelMap: {},
        previewInstrumentedProject: null,
      };
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
    // Persistence is surface-aware: chat-surface dispatches persist under the
    // chat-agent context id; code-surface dispatches persist under the active
    // dashboard id. Action carries surface=='chat' explicitly; otherwise we
    // fall back to the legacy "infer from appMode" rule for back-compat with
    // older callers that have not been updated yet.
    const isChat = action.surface === 'chat'
      || (action.surface !== 'code' && newState.appMode === 'chat' && newState.chatActiveTabId);
    const f = fieldsFor(isChat ? 'chat' : 'code');
    const persistDid = isChat
      ? (newState.chatClaudeDashboardId || activeChatContextId(newState))
      : newState.currentDashboardId;
    schedulePersist(persistDid, newState[f.activeTabId], newState[f.messages]);
  }
  return newState;
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(appReducer, initialState);

  // One-shot migration: project tabs with subtabs lacking agentHex get backfilled.
  const backfilledRef = useRef(false);
  useEffect(() => {
    if (backfilledRef.current) return;
    const api = typeof window !== 'undefined' ? window.electronAPI : null;
    if (!api || typeof api.createChatAgent !== 'function') return;
    const stale = state.chatTabs.filter(t =>
      t.subtabs && t.subtabs.some(s => !s.agentHex)
    );
    if (stale.length === 0) { backfilledRef.current = true; return; }
    backfilledRef.current = true;
    (async () => {
      for (const tab of stale) {
        try {
          const result = await api.createChatAgent({ projectPath: tab.projectPath || null });
          if (result && result.agentHex) {
            dispatch({
              type: 'CHAT_TAB_BACKFILL_AGENT',
              tabId: tab.id,
              agentHex: result.agentHex,
              chatNumber: result.chatNumber,
            });
          }
        } catch (err) {
          console.warn('[chat-tab backfill] failed for', tab.id, err);
        }
      }
    })();
  }, [state.chatTabs]);

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

// Returns a flat view of the requested Claude chat slice. Callers pass either
// 'code' (default) or 'chat' to read from claude* / chatClaude* respectively.
// Lets components stay surface-agnostic — read state.claudeMessages or
// state.chatClaudeMessages through the same key (`messages`) by destructuring
// this helper. Field set is intentionally identical across both slices so
// components can switch on appMode without conditional field names.
export function getClaudeSlice(state, surface) {
  const f = fieldsFor(surface);
  return {
    messages: state[f.messages],
    isProcessing: state[f.isProcessing],
    status: state[f.status],
    activeTabId: state[f.activeTabId],
    tabs: state[f.tabs],
    tabStash: state[f.tabStash],
    processingStash: state[f.processingStash],
    activeTabMap: state[f.activeTabMap],
    pendingAttachments: state[f.pendingAttachments],
    dashboardId: state[f.dashboardId],
  };
}
