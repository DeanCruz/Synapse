import { WEBVIEW_BRIDGE_PROTOCOL, WEBVIEW_MESSAGE_TYPES } from './WebviewBridge';

interface WebviewUriLike {
  toString(): string;
}

interface WebviewLike {
  cspSource: string;
  asWebviewUri(uri: WebviewUriLike): WebviewUriLike;
}

export interface WebviewHtmlOptions {
  title?: string;
  nonce?: string;
  styleUris?: WebviewUriLike[];
  scriptUris?: WebviewUriLike[];
  initialState?: unknown;
}

function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i += 1) {
    nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return nonce;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toWebviewUri(webview: WebviewLike, uri: WebviewUriLike): string {
  return webview.asWebviewUri(uri).toString();
}

function serializeInitialState(initialState: unknown): string {
  if (initialState === undefined) {
    return 'null';
  }

  return JSON.stringify(initialState).replace(/</g, '\\u003c');
}

export function getWebviewHtml(
  webview: WebviewLike,
  {
    title = 'Synapse',
    nonce = createNonce(),
    styleUris = [],
    scriptUris = [],
    initialState,
  }: WebviewHtmlOptions = {}
): string {
  const styleTags = styleUris
    .map((uri) => `<link rel="stylesheet" href="${escapeHtml(toWebviewUri(webview, uri))}">`)
    .join('\n');

  const scriptTags = scriptUris
    .map((uri) => `<script nonce="${nonce}" src="${escapeHtml(toWebviewUri(webview, uri))}"></script>`)
    .join('\n');

  const bootState = serializeInitialState(initialState);

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; img-src ${webview.cspSource} https: data:; font-src ${webview.cspSource} data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}' ${webview.cspSource}; connect-src ${webview.cspSource} https:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="synapse-webview-protocol" content="${WEBVIEW_BRIDGE_PROTOCOL}">
  <title>${escapeHtml(title)}</title>
  ${styleTags}
</head>
<body data-synapse-webview="true">
  <div id="root"></div>
  <script nonce="${nonce}">
    (function () {
      const vscode = acquireVsCodeApi();
      const initialState = ${bootState};
      const inbox = [];
      let listener = null;

      function dispatch(message) {
        if (!message || typeof message !== 'object') {
          return;
        }

        if (message.protocol && message.protocol !== ${JSON.stringify(WEBVIEW_BRIDGE_PROTOCOL)}) {
          return;
        }

        if (message.type === ${JSON.stringify(WEBVIEW_MESSAGE_TYPES.STATE)} && typeof vscode.setState === 'function') {
          vscode.setState(message.state);
        }

        if (listener) {
          listener(message);
          return;
        }

        inbox.push(message);
      }

      if (initialState !== null && typeof initialState !== 'undefined' && typeof vscode.setState === 'function') {
        vscode.setState(initialState);
      }

      window.synapseWebview = Object.freeze({
        protocol: ${JSON.stringify(WEBVIEW_BRIDGE_PROTOCOL)},
        messageTypes: ${JSON.stringify(WEBVIEW_MESSAGE_TYPES)},
        postMessage: function (message) {
          const envelope = Object.assign({}, message, { protocol: ${JSON.stringify(WEBVIEW_BRIDGE_PROTOCOL)} });
          return vscode.postMessage(envelope);
        },
        getState: function () {
          return vscode.getState();
        },
        setState: function (state) {
          return vscode.setState(state);
        },
        __setListener: function (nextListener) {
          listener = typeof nextListener === 'function' ? nextListener : null;
          if (!listener) {
            return;
          }

          while (inbox.length > 0) {
            listener(inbox.shift());
          }
        },
        __dispatch: dispatch
      });

      window.addEventListener('message', function (event) {
        dispatch(event.data);
      });

      vscode.postMessage({
        type: ${JSON.stringify(WEBVIEW_MESSAGE_TYPES.READY)},
        protocol: ${JSON.stringify(WEBVIEW_BRIDGE_PROTOCOL)}
      });
    }());
  </script>
  ${scriptTags}
</body>
</html>`;
}
