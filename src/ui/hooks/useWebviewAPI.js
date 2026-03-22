import { useMemo } from 'react';

const WEBVIEW_BRIDGE_PROTOCOL = 'synapse-webview-bridge/v1';

const WEBVIEW_MESSAGE_TYPES = Object.freeze({
  READY: 'synapse:bridge:ready',
  REQUEST: 'synapse:bridge:request',
  RESPONSE: 'synapse:bridge:response',
  EVENT: 'synapse:bridge:event',
  STATE: 'synapse:bridge:state',
});

const WEBVIEW_EVENT_CHANNELS = Object.freeze([
  'initialization',
  'logs',
  'agent_progress',
  'all_progress',
  'dashboards_list',
  'dashboards_changed',
  'queue_changed',
  'reload',
  'worker-output',
  'worker-complete',
  'worker-error',
]);

const WEBVIEW_LEGACY_METHODS = Object.freeze([
  'getDashboards',
  'getDashboardStatuses',
  'getDashboardInit',
  'getDashboardLogs',
  'getDashboardProgress',
  'clearDashboard',
  'archiveDashboard',
  'saveDashboardHistory',
  'exportDashboard',
  'getOverview',
  'getArchives',
  'getArchive',
  'deleteArchive',
  'getHistory',
  'getQueue',
  'getQueueItem',
  'getSettings',
  'setSetting',
  'resetSettings',
  'selectProjectDirectory',
  'loadProject',
  'getRecentProjects',
  'addRecentProject',
  'getProjectContext',
  'scanProjectDirectory',
  'detectClaudeCli',
  'detectAgentCli',
  'createSwarm',
  'addTask',
  'updateTask',
  'removeTask',
  'addWave',
  'removeWave',
  'nextTaskId',
  'validateDependencies',
  'listCommands',
  'getCommand',
  'saveCommand',
  'deleteCommand',
  'loadProjectClaudeMd',
  'listProjectCommands',
  'getChatSystemPrompt',
  'logChatEvent',
  'saveTempImages',
  'spawnWorker',
  'killWorker',
  'killAllWorkers',
  'getActiveWorkers',
  'startSwarm',
  'pauseSwarm',
  'resumeSwarm',
  'cancelSwarm',
  'retryTask',
  'getSwarmStates',
  'listConversations',
  'loadConversation',
  'saveConversation',
  'createConversation',
  'deleteConversation',
  'renameConversation',
  'saveTempFile',
  'selectImageFile',
  'readFileAsBase64',
]);

let cachedApi = null;
let requestCounter = 0;

function isWebviewEnvironment() {
  if (typeof window === 'undefined') return false;
  // Check for the boot-script bridge first (acquireVsCodeApi is consumed after first call)
  if (window.synapseWebview) return true;
  return typeof window.acquireVsCodeApi === 'function';
}

function createRequestId() {
  requestCounter += 1;
  return `synapse-webview-${Date.now()}-${requestCounter}`;
}

function createErrorFromPayload(payload) {
  const message = payload && typeof payload.message === 'string'
    ? payload.message
    : 'Webview bridge request failed';
  const error = new Error(message);
  if (payload && typeof payload.name === 'string') error.name = payload.name;
  if (payload && typeof payload.stack === 'string') error.stack = payload.stack;
  return error;
}

function createWebviewAPI() {
  if (!isWebviewEnvironment()) return null;
  if (cachedApi) return cachedApi;

  // The boot script in getWebviewHtml.ts calls acquireVsCodeApi() (which can only
  // be called once) and exposes window.synapseWebview. Use it as the transport
  // layer instead of trying to call acquireVsCodeApi() again.
  const bridge = window.synapseWebview;
  const vscode = bridge
    ? { postMessage: (m) => bridge.postMessage(m), getState: () => bridge.getState(), setState: (s) => bridge.setState(s) }
    : window.acquireVsCodeApi();

  const listeners = new Map();
  const pendingRequests = new Map();
  const allowedChannels = new Set(WEBVIEW_EVENT_CHANNELS);

  const handleMessage = (message) => {
    // When using the boot-script bridge, messages arrive unwrapped (no event.data).
    // When using raw window messages, they arrive as event.data.
    if (!message || typeof message !== 'object') return;
    if (message.protocol && message.protocol !== WEBVIEW_BRIDGE_PROTOCOL) return;

    if (message.type === WEBVIEW_MESSAGE_TYPES.RESPONSE && message.requestId) {
      const pending = pendingRequests.get(message.requestId);
      if (!pending) return;
      pendingRequests.delete(message.requestId);
      if (message.ok) {
        pending.resolve(message.result);
      } else {
        pending.reject(createErrorFromPayload(message.error));
      }
      return;
    }

    if (message.type === WEBVIEW_MESSAGE_TYPES.STATE) {
      vscode.setState(message.state);
      return;
    }

    if (message.type !== WEBVIEW_MESSAGE_TYPES.EVENT || !message.channel) {
      return;
    }

    const channelListeners = listeners.get(message.channel);
    if (!channelListeners || channelListeners.size === 0) return;

    channelListeners.forEach((listener) => {
      try {
        listener(message.payload);
      } catch (_) {
        // Listener errors should not break the bridge.
      }
    });
  };

  let windowListener = null;
  if (bridge) {
    // Use the boot-script's listener system — messages are pre-unwrapped
    bridge.__setListener(handleMessage);
  } else {
    // Fallback: listen on window (messages need unwrapping)
    windowListener = (event) => handleMessage(event && event.data);
    window.addEventListener('message', windowListener);
  }

  const api = {
    protocol: WEBVIEW_BRIDGE_PROTOCOL,
    messageTypes: WEBVIEW_MESSAGE_TYPES,
    postMessage(message) {
      return vscode.postMessage({
        ...message,
        protocol: WEBVIEW_BRIDGE_PROTOCOL,
      });
    },
    invoke(method, params) {
      const requestId = createRequestId();
      return new Promise((resolve, reject) => {
        pendingRequests.set(requestId, { resolve, reject });
        vscode.postMessage({
          protocol: WEBVIEW_BRIDGE_PROTOCOL,
          type: WEBVIEW_MESSAGE_TYPES.REQUEST,
          requestId,
          method,
          params,
        });
      });
    },
    request(method, params) {
      return api.invoke(method, params);
    },
    on(channel, callback) {
      if (!allowedChannels.has(channel)) {
        return null;
      }

      if (!listeners.has(channel)) {
        listeners.set(channel, new Set());
      }

      const wrapped = (payload) => callback(payload);
      listeners.get(channel).add(wrapped);
      return wrapped;
    },
    off(channel, listener) {
      if (!allowedChannels.has(channel)) {
        return;
      }

      const channelListeners = listeners.get(channel);
      if (!channelListeners) return;
      channelListeners.delete(listener);
      if (channelListeners.size === 0) listeners.delete(channel);
    },
    getState() {
      return vscode.getState();
    },
    setState(state) {
      return vscode.setState(state);
    },
    sendReady() {
      return vscode.postMessage({
        protocol: WEBVIEW_BRIDGE_PROTOCOL,
        type: WEBVIEW_MESSAGE_TYPES.READY,
      });
    },
    dispose() {
      if (bridge) {
        bridge.__setListener(null);
      } else if (windowListener) {
        window.removeEventListener('message', windowListener);
      }
      pendingRequests.forEach(({ reject }) => {
        reject(new Error('Webview bridge disposed'));
      });
      pendingRequests.clear();
      listeners.clear();
      if (window.synapseWebviewAPI === api) {
        window.synapseWebviewAPI = null;
      }
      cachedApi = null;
    },
  };

  WEBVIEW_LEGACY_METHODS.forEach((method) => {
    api[method] = (...args) => api.invoke(method, args.length <= 1 ? args[0] : args);
  });

  window.synapseWebviewAPI = api;
  cachedApi = api;
  return api;
}

export function useWebviewAPI() {
  return useMemo(() => createWebviewAPI(), []);
}

export function useIsWebview() {
  return isWebviewEnvironment();
}

export {
  WEBVIEW_BRIDGE_PROTOCOL,
  WEBVIEW_EVENT_CHANNELS,
  WEBVIEW_LEGACY_METHODS,
  WEBVIEW_MESSAGE_TYPES,
  createWebviewAPI,
};
